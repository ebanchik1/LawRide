// GET /api/health — is this deploy actually configured?
//
// Why this exists: every integration in this app fails SILENTLY by design, so
// users never see a stack trace. The cost is that a misconfigured deploy looks
// identical to a healthy one. Three times now that has cost real clarity:
// Supabase env vars missing would have meant every save discarded; the Vercel
// Upstash integration injects KV_REST_API_* rather than UPSTASH_REDIS_REST_*,
// leaving the spend cap a no-op; and none of it surfaces anywhere.
//
// This endpoint turns "I set the variables" into something checkable.
//
// It reports BOOLEANS ONLY — never a key, a URL, or any fragment of one.
//
// Access: requires HEALTH_TOKEN to be set in the environment and supplied as
// ?token=... Without HEALTH_TOKEN configured the endpoint 404s, so it fails
// CLOSED. That matters because "rate limiting is off" is exactly the fact an
// abuser would most like to confirm before pointing a loop at your API key.

import { rateLimitBackend } from "./_guards.js";
import { supabaseConfigured } from "./_db.js";

export default function handler(req, res) {
  const expected = process.env.HEALTH_TOKEN;
  const supplied = req.query?.token;

  // Not configured, wrong token, or wrong method → indistinguishable 404.
  if (!expected || supplied !== expected || req.method !== "GET") {
    return res.status(404).json({ error: "Not found" });
  }

  const checks = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    supabase: supabaseConfigured,
    rate_limit_backend: rateLimitBackend, // "redis" = real; "memory" = spend cap is a no-op
    daily_cap: Number(process.env.AI_DAILY_CALL_CAP || 3000),
  };

  // Anything false here means a feature is silently degraded in production.
  const degraded = [];
  if (!checks.anthropic) degraded.push("AI features disabled (no ANTHROPIC_API_KEY)");
  if (!checks.supabase) degraded.push("saves and analytics discarded (no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  if (checks.rate_limit_backend !== "redis") {
    degraded.push("no cross-instance rate limiting and the daily AI spend cap is NOT enforced (no UPSTASH_REDIS_REST_* or KV_REST_API_*)");
  }

  return res.status(200).json({ ok: degraded.length === 0, checks, degraded });
}
