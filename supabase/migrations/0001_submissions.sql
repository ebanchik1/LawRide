-- LawRide: `submissions` table — the outcome-capture dataset (the moat surface).
--
-- Written by the server only, via the Supabase SERVICE_ROLE key (see api/_db.js).
-- Append-only: every "save my results" is a NEW row (surrogate id PK, email
-- indexed but NOT unique) so a person who re-runs keeps their longitudinal
-- history. `bucket_source` keeps AI-classified softs distinguishable from
-- self-reported ones during calibration.
--
-- Reflects exactly what POST /api/submit inserts (api/submit.js).

create table if not exists public.submissions (
  id            bigint generated always as identity primary key,
  email         text not null,
  gpa           numeric(4, 3),   -- 2.000–4.330, validated app-side
  lsat          integer,         -- 120–180, validated app-side
  app_date      text,            -- applicant's intended/actual submission date
  softs_bucket  text check (softs_bucket in ('poor', 'average', 'above_average', 'excellent')),
  bucket_source text not null default 'user' check (bucket_source in ('ai', 'user')),
  schools       jsonb,           -- array of school names on the estimate (capped at 40 app-side)
  created_at    timestamptz not null default now()
);

-- Email is indexed (for future account linking / dedupe analysis) but NOT
-- unique — append-only history depends on repeats being allowed.
create index if not exists submissions_email_idx      on public.submissions (email);
create index if not exists submissions_created_at_idx on public.submissions (created_at);

-- RLS on with NO policies: the public anon key can touch nothing. Only the
-- server's service_role key (which bypasses RLS) can read/write. This is the
-- guarantee api/_db.js documents.
alter table public.submissions enable row level security;
