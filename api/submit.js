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

import { guard, validateStats } from "./_guards.js";
import { db, supabaseConfigured } from "./_db.js";

const BUCKETS = ["poor", "average", "above_average", "excellent"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  const blocked = await guard(req);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error });

  const { email, gpa, lsat, app_date, softs_bucket, bucket_source, schools } = req.body || {};

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required to save your results." });
  }
  if (gpa != null && lsat != null) {
    const statErr = validateStats(Number(gpa), Number(lsat));
    if (statErr) return res.status(statErr.status).json({ error: statErr.error });
  }

  const bucket = BUCKETS.includes(softs_bucket) ? softs_bucket : null;
  const source = bucket_source === "ai" ? "ai" : "user";

  if (!supabaseConfigured) {
    return res.status(200).json({ ok: false, saved: false }); // no DB wired — don't block the user
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
      })
      .select("id")
      .single();

    if (error) {
      console.error("Submit: insert failed", error.code); // code only, never the row
      return res.status(200).json({ ok: false, saved: false });
    }
    return res.status(200).json({ ok: true, saved: true, id: data.id });
  } catch {
    console.error("Submit: unexpected error");
    return res.status(200).json({ ok: false, saved: false });
  }
}
