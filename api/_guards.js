// Shared request guards for the AI proxy endpoints (strategy + recommendations).
// Centralizes rate limiting, the API-key check, input caps, and prompt-field
// sanitization so a security fix lands in one place instead of being copy-pasted.
//
// Rate limiting strategy:
//   - If Upstash Redis is configured (UPSTASH_REDIS_REST_URL +
//     UPSTASH_REDIS_REST_TOKEN — added via the Vercel Marketplace Redis
//     integration), use a shared, cross-instance counter — a real limiter.
//   - Otherwise fall back to a per-instance in-memory window. Best-effort only:
//     it resets on cold start and isn't shared across serverless instances, so
//     it does NOT stop a determined caller. Configure Redis for real protection.
//   - The global daily cap (Redis-only) is the real backstop against runaway
//     Anthropic spend, since per-IP limiting is defeatable via spoofed
//     X-Forwarded-For headers.

import { Redis } from "@upstash/redis";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
// Global per-day call ceiling across ALL callers. Enforceable only with Redis.
// Tune via env; generous default so real users are never the ones capped.
const DAILY_CAP = Number(process.env.AI_DAILY_CALL_CAP || 3000);

const redisConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = redisConfigured
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

// Per-instance fallback window (see note above).
const memWindows = new Map();

export function getClientIp(req) {
  // X-Forwarded-For is a comma-separated list "client, proxy1, proxy2".
  // Use the left-most entry (the originating client). Still spoofable, which
  // is exactly why the KV daily cap — not per-IP limiting — is the real guard.
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function memRateOk(ip) {
  const now = Date.now();
  const e = memWindows.get(ip);
  if (!e || now - e.start > WINDOW_MS) {
    memWindows.set(ip, { start: now, count: 1 });
    return true;
  }
  e.count += 1;
  return e.count <= MAX_PER_WINDOW;
}

async function redisRateOk(ip) {
  const key = `rl:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, Math.ceil(WINDOW_MS / 1000));
  return count <= MAX_PER_WINDOW;
}

// Method + API-key + per-IP rate limit. Returns null to proceed, or
// { status, error } to short-circuit. Does NOT touch the daily cap — that is
// charged separately, right before the paid call, so junk requests rejected at
// validation can't burn the global budget.
export async function guard(req) {
  if (req.method !== "POST") return { status: 405, error: "Method not allowed" };
  if (!process.env.ANTHROPIC_API_KEY) return { status: 500, error: "API key not configured" };

  const ip = getClientIp(req);
  let ok;
  try {
    ok = redisConfigured ? await redisRateOk(ip) : memRateOk(ip);
  } catch {
    ok = memRateOk(ip); // Redis hiccup → fall back, don't 500 the user
  }
  if (!ok) return { status: 429, error: "Too many requests. Please wait a minute and try again." };
  return null;
}

// Charge one unit against the global daily budget. Call this AFTER input
// validation, immediately before the Anthropic request. Returns true if the
// cap is already exhausted (caller should 429). No-op (returns false) without KV.
export async function dailyCapExceeded() {
  if (!redisConfigured) return false;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = `aispend:${day}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60 * 60 * 26); // ~26h TTL
    return count > DAILY_CAP;
  } catch {
    return false; // fail open on Redis error
  }
}

export function validateStats(gpa, lsat) {
  if (gpa < 2.0 || gpa > 4.33 || lsat < 120 || lsat > 180) {
    return { status: 400, error: "Invalid GPA or LSAT values" };
  }
  return null;
}

export const MAX_LIST = 40;

// Cap a client-supplied array so a single request can't be made arbitrarily
// expensive by sending thousands of items into the prompt.
export function capList(arr, max = MAX_LIST) {
  return Array.isArray(arr) ? arr.slice(0, max) : [];
}

// Sanitize any client string interpolated into a prompt: strip newlines (blunts
// prompt injection) and clamp length (blunts prompt bloat).
export function clampField(v, max = 80) {
  return String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, max);
}

// Coerce a client numeric to a finite number, or 0. Stops text smuggled through
// numeric fields from landing in the prompt.
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
