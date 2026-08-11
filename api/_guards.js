// Shared request guards for the API routes.
// Centralizes rate limiting, the API-key check, input caps, and prompt-field
// sanitization so a security fix lands in one place instead of being copy-pasted.
//
// Two guards, deliberately separate:
//   - guard(req)       — the AI proxies (strategy, recommendations, resume).
//                        Requires ANTHROPIC_API_KEY; tight per-IP budget because
//                        every call costs money.
//   - guardSubmit(req) — /api/submit. Costs nothing to serve, needs no Anthropic
//                        key, and is the conversion event the outcome dataset
//                        depends on, so it gets its own roomier bucket.
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
// /api/submit gets a separate, roomier allowance. Sharing the AI bucket meant a
// normal session — resume upload, estimate, strategy, recommendations, a retry
// or two — could exhaust the 10/min allowance and then 429 the save. In the
// client that surfaced as a generic error with no event, so a rate-limit
// failure was indistinguishable from a user declining to hand over their email.
const SUBMIT_MAX_PER_WINDOW = 30;
// Telemetry fires many times per session by design (session_start, estimate_run,
// save_attempted, ...). Its bucket is sized so a heavy but legitimate session
// never trips it, while a flood still gets cut off. Dropping a telemetry write
// is harmless; dropping a save is not — which is exactly why they are separate.
const EVENT_MAX_PER_WINDOW = 120;
// Global per-day call ceiling across ALL callers. Enforceable only with Redis.
// Tune via env; generous default so real users are never the ones capped.
const DAILY_CAP = Number(process.env.AI_DAILY_CALL_CAP || 3000);

// Accept BOTH naming conventions.
//
// Upstash's own docs use UPSTASH_REDIS_REST_*, but the Vercel Marketplace
// integration injects the same credentials as KV_REST_API_URL / KV_REST_API_TOKEN.
// Reading only one set means connecting the database through the Vercel UI
// appears to work, injects five variables, and leaves the limiter silently OFF —
// with the daily spend cap a no-op — because the names didn't match. Nothing
// errors, so there is no signal. Accept either.
//
// Deliberately NOT falling back to KV_REST_API_READ_ONLY_TOKEN: every operation
// here is INCR/EXPIRE, so a read-only token would fail on every call and drop
// us back to the in-memory fallback — the same silent no-op, one layer deeper.
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const redisConfigured = Boolean(redisUrl && redisToken);
const redis = redisConfigured ? new Redis({ url: redisUrl, token: redisToken }) : null;

// Exported so a deploy can be checked without guessing. See /api/health.
export const rateLimitBackend = redisConfigured ? "redis" : "memory";

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

// Bounded so a long-lived instance seeing many IPs can't grow the map without
// limit. Well above any realistic concurrent-IP count for this app.
const MEM_WINDOWS_MAX = 5000;

function memRateOk(bucket, ip, max) {
  const now = Date.now();
  const k = `${bucket}:${ip}`;
  const e = memWindows.get(k);
  if (!e || now - e.start > WINDOW_MS) {
    if (memWindows.size >= MEM_WINDOWS_MAX) {
      // Drop entries whose window has already expired; if none have, clear
      // outright. Either way the limiter stays best-effort, which is what its
      // contract already says.
      for (const [key, val] of memWindows) {
        if (now - val.start > WINDOW_MS) memWindows.delete(key);
      }
      if (memWindows.size >= MEM_WINDOWS_MAX) memWindows.clear();
    }
    memWindows.set(k, { start: now, count: 1 });
    return true;
  }
  e.count += 1;
  return e.count <= max;
}

async function redisRateOk(bucket, ip, max) {
  const key = `rl:${bucket}:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, Math.ceil(WINDOW_MS / 1000));
  return count <= max;
}

// Per-IP rate limit against one named bucket. Buckets are independent, so
// spending the AI allowance cannot lock a user out of saving their results.
async function rateOk(bucket, ip, max) {
  try {
    return redisConfigured ? await redisRateOk(bucket, ip, max) : memRateOk(bucket, ip, max);
  } catch {
    return memRateOk(bucket, ip, max); // Redis hiccup → fall back, don't 500 the user
  }
}

// Method + API-key + per-IP rate limit for the paid AI routes. Returns null to
// proceed, or { status, error } to short-circuit. Does NOT touch the daily cap —
// that is charged separately, right before the paid call, so junk requests
// rejected at validation can't burn the global budget.
export async function guard(req) {
  if (req.method !== "POST") return { status: 405, error: "Method not allowed" };
  if (!process.env.ANTHROPIC_API_KEY) return { status: 500, error: "API key not configured" };

  if (!(await rateOk("ai", getClientIp(req), MAX_PER_WINDOW))) {
    return { status: 429, error: "Too many requests. Please wait a minute and try again." };
  }
  return null;
}

// Guard for /api/submit. Intentionally does NOT require ANTHROPIC_API_KEY:
// saving a submission makes no model call, and gating it on an unrelated env
// var meant a misconfigured or key-less deploy returned 500 "API key not
// configured" on the one endpoint that builds the outcome dataset.
export async function guardSubmit(req) {
  if (req.method !== "POST") return { status: 405, error: "Method not allowed" };

  if (!(await rateOk("submit", getClientIp(req), SUBMIT_MAX_PER_WINDOW))) {
    return { status: 429, error: "Too many requests. Please wait a minute and try again." };
  }
  return null;
}

// Guard for /api/event (telemetry). Own bucket, no Anthropic key. The caller
// converts any rejection into a silent 204 — telemetry never surfaces to users.
export async function guardEvent(req) {
  if (req.method !== "POST") return { status: 405, error: "Method not allowed" };

  if (!(await rateOk("event", getClientIp(req), EVENT_MAX_PER_WINDOW))) {
    return { status: 429, error: "Too many requests" };
  }
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
