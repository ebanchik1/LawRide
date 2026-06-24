// Server-side Supabase client for LawRide.
//
// Uses the SERVICE_ROLE key, which bypasses Row Level Security — so this file
// must ONLY ever be imported by serverless functions (api/*), never bundled
// into client code. RLS is enabled on `submissions`, so the public anon key
// can't touch it; the server reaches it via service_role.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// True only when both env vars are present (so a missing config degrades to a
// clean 500 instead of throwing at import time).
export const supabaseConfigured = Boolean(url && key);

export const db = supabaseConfigured
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;
