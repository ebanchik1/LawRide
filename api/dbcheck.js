// TEMPORARY connectivity check — confirms SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are set and the `submissions` table is reachable from a serverless function.
// Remove once the Supabase connection is verified.

import { db, supabaseConfigured } from "./_db.js";

export default async function handler(req, res) {
  if (!supabaseConfigured) {
    return res.status(500).json({
      ok: false,
      stage: "env",
      error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set on this deployment",
    });
  }
  try {
    // head:true → no rows returned, just the exact count. Reaches the table
    // via service_role (bypasses RLS).
    const { count, error } = await db
      .from("submissions")
      .select("*", { count: "exact", head: true });
    if (error) {
      return res.status(500).json({ ok: false, stage: "query", error: error.message, code: error.code });
    }
    return res.status(200).json({ ok: true, table: "submissions", rowCount: count ?? 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, stage: "exception", error: String(e?.message || e) });
  }
}
