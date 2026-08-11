// POST /api/event — record one funnel event.
//
// This is the gate's data source. Vercel Web Analytics is not: custom events
// are unavailable on Hobby, capped at 2 properties on Pro, and retained for one
// month on Hobby. Owning the table makes the funnel a SQL join against
// `submissions` (see supabase/migrations/0003_events.sql).
//
// Contract: always HTTP 204, always fast, never blocks the user. The client
// fires these with sendBeacon and ignores the response — a telemetry failure
// must never be visible in the product.
//
// PII rule: the event NAME is allowlisted and prop VALUES are coerced to
// bounded scalars, so no free-form user text (email, resume content, school
// search strings) can reach this table even if a client is modified to try.

import { guardEvent } from "./_guards.js";
import { db, supabaseConfigured } from "./_db.js";

// Allowlist. An unknown name is dropped, not stored — this is what stops the
// endpoint from becoming an open write channel into your database.
const EVENTS = new Set([
  "session_start",
  "returned",
  "estimate_run",
  "recommendations_run",
  "resume_attempted",
  "resume_uploaded",
  "resume_failed",
  "save_attempted",
  "save_succeeded",
  "save_failed",
]);

// Shape of the client-generated ids (src/lib/session.js).
const ID_RE = /^[a-f0-9]{8,64}$/;
const MAX_PROPS = 10;
const MAX_KEY = 40;
const MAX_VALUE = 80;

// Strings are clamped, numbers must be finite, booleans/null pass through, and
// anything else (objects, arrays, functions) is dropped entirely.
function sanitizeProps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= MAX_PROPS) break;
    if (typeof k !== "string" || k.length > MAX_KEY) continue;
    if (v === null || typeof v === "boolean") { out[k] = v; n++; continue; }
    if (typeof v === "number") { if (Number.isFinite(v)) { out[k] = v; n++; } continue; }
    if (typeof v === "string") { out[k] = v.slice(0, MAX_VALUE); n++; continue; }
    // objects / arrays / anything else: dropped
  }
  return n ? out : null;
}

export default async function handler(req, res) {
  const blocked = await guardEvent(req);
  // Even a rejection returns 204: the client can't act on it and shouldn't see
  // a console error for telemetry. The guard still does its job of not writing.
  if (blocked) return res.status(204).end();

  const { name, session_id, visitor_id, props } = req.body || {};
  if (!EVENTS.has(name)) return res.status(204).end();
  if (!supabaseConfigured) return res.status(204).end();

  const ok = (v) => (typeof v === "string" && ID_RE.test(v) ? v : null);

  try {
    const { error } = await db.from("events").insert({
      name,
      session_id: ok(session_id),
      visitor_id: ok(visitor_id),
      props: sanitizeProps(props),
    });
    if (error) console.error("Event: insert failed", error.code); // code only, never the row
  } catch {
    console.error("Event: unexpected error");
  }
  return res.status(204).end();
}
