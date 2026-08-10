-- LawRide: `events` — the funnel telemetry table.
--
-- Why this exists instead of leaning on Vercel Web Analytics:
--   * Vercel Web Analytics does not support custom events on the Hobby plan at
--     all, so custom events on a free deploy are simply not collected.
--   * On Pro, custom events are capped at 2 properties each — not enough to
--     carry correlation ids plus the event's own dimensions.
--   * The Hobby reporting window is 1 month, too short for a cycle-shaped
--     product.
-- Owning the table removes all three limits and, more importantly, makes the
-- funnel a SQL join against `submissions` rather than two dashboards you have
-- to eyeball side by side.
--
-- PII rule, same as `submissions`: no email, no resume text, no free-form user
-- input ever lands here. `props` carries bounded, enum-ish values only, and
-- /api/event enforces that server-side (allowlisted event names, scalar-only
-- props, clamped lengths).

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  session_id text,                      -- one per visit    → joins submissions.session_id
  visitor_id text,                      -- one per browser  → joins submissions.visitor_id
  name       text not null,             -- allowlisted server-side (api/event.js)
  props      jsonb,                     -- scalar values only, capped app-side
  created_at timestamptz not null default now()
);

create index if not exists events_session_id_idx on public.events (session_id);
create index if not exists events_visitor_id_idx on public.events (visitor_id);
create index if not exists events_name_idx       on public.events (name);
create index if not exists events_created_at_idx on public.events (created_at);

-- RLS on with NO policies: the anon key can touch nothing; only the server's
-- service_role key (which bypasses RLS) writes here. Same guarantee as
-- `submissions` — see api/_db.js.
alter table public.events enable row level security;


-- ---------------------------------------------------------------------------
-- Running the gate. Count DISTINCT ids, never rows: one person clicking Save
-- four times with a typo'd email is four `save_attempted` rows and one human.
-- ---------------------------------------------------------------------------

-- Per-visit conversion — the funnel proper.
--
--   select
--     count(distinct session_id) filter (where name = 'estimate_run')   as visits_estimated,
--     count(distinct session_id) filter (where name = 'save_succeeded') as visits_saved
--   from public.events
--   where created_at > now() - interval '30 days';

-- Per-person conversion — "do applicants, eventually, hand over an email?"
-- This is the higher number, and the one that matters for the moat.
--
--   select
--     count(distinct visitor_id) filter (where name = 'estimate_run')   as people_estimated,
--     count(distinct visitor_id) filter (where name = 'save_succeeded') as people_saved
--   from public.events
--   where created_at > now() - interval '30 days';

-- Are saves failing for reasons that aren't the user's choice? If `rate_limited`
-- or `not_configured` shows up at all, the conversion numbers above are wrong.
--
--   select props->>'reason' as reason, count(*)
--   from public.events where name = 'save_failed'
--   group by 1 order by 2 desc;

-- Resume classifier health. `upstream_*` means Anthropic, not your prompt.
--
--   select props->>'reason' as reason, count(*)
--   from public.events where name = 'resume_failed'
--   group by 1 order by 2 desc;

-- The five-applicant read: one row per visit, in order. This is the query to
-- actually stare at during the gate — it shows where each person stopped.
--
--   select session_id,
--          min(created_at) as started,
--          array_agg(name order by created_at) as journey
--   from public.events
--   group by session_id
--   order by started desc
--   limit 50;
