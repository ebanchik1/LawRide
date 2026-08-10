// POST /api/submit — persist one submission row (the "save my results" moment).
//
// Append-only: each save is a NEW row (surrogate id PK, email indexed, NOT
// unique) so a person who re-runs keeps their longitudinal history — that's the
// outcome dataset. Records bucket_source ('ai' | 'user') so AI-classified and
// self-reported softs stay distinguishable in calibration.
//
// DB failure must NOT break the user's flow: on any Supabase error we return
// 200 { ok:false, saved:false } so the client can show "couldn't save" softly
// without losing the estimate. Logs codes only — never PII.

// Uses guardSubmit, NOT the AI guard: this route makes no model call, so it
// must not require ANTHROPIC_API_KEY and must not share the AI per-IP budget.
// It also echoes a machine-readable `reason` on every non-save so the client can
// report *why* a save failed instead of collapsing every path into "error".

import { guardSubmit, validateStats } from "./_guards.js";
import { db, supabaseConfigured } from "./_db.js";

const BUCKETS = ["poor", "average", "above_average", "excellent"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Client-generated correlation ids (see src/lib/session.js). Hex only and
// bounded — they land in DB columns, so don't accept arbitrary client text.
const ID_RE = /^[a-f0-9]{8,64}$/;

export default async function handler(req, res) {
  const blocked = await guardSubmit(req);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error });

  const { email, gpa, lsat, app_date, softs_bucket, bucket_source, schools, session_id, visitor_id } = req.body || {};

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required to save your results." });
  }
  if (gpa != null && lsat != null) {
    const statErr = validateStats(Number(gpa), Number(lsat));
    if (statErr) return res.status(statErr.status).json({ error: statErr.error });
  }

  const bucket = BUCKETS.includes(softs_bucket) ? softs_bucket : null;
  const source = bucket_source === "ai" ? "ai" : "user";
  const sid = typeof session_id === "string" && ID_RE.test(session_id) ? session_id : null;
  const vid = typeof visitor_id === "string" && ID_RE.test(visitor_id) ? visitor_id : null;

  if (!supabaseConfigured) {
    // No DB wired — don't block the user, but say so distinctly. A deploy
    // missing SUPABASE_* silently dropping every submission is exactly the
    // failure that would make the gate read as "nobody saves".
    return res.status(200).json({ ok: false, saved: false, reason: "not_configured" });
  }

  try {
    const { data, error } = await db
      .from("submissions")
      .insert({
        email: email.trim().toLowerCase(),
        gpa: gpa != null ? Number(gpa) : null,
        lsat: lsat != null ? Number(lsat) : null,
        app_date: app_date || null,
        softs_bucket: bucket,
        bucket_source: source,
        schools: Array.isArray(schools) ? schools.slice(0, 40) : null,
        session_id: sid,
        visitor_id: vid,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Submit: insert failed", error.code); // code only, never the row
      return res.status(200).json({ ok: false, saved: false, reason: "db_error" });
    }
    return res.status(200).json({ ok: true, saved: true, id: data.id });
  } catch {
    console.error("Submit: unexpected error");
    return res.status(200).json({ ok: false, saved: false, reason: "db_error" });
  }
}
