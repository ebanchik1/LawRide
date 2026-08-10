-- LawRide: add correlation ids to `submissions`.
--
-- Why: analytics events and this table were two disconnected datasets. You
-- could count estimates fired and count rows landed, but not join them — so the
-- gate's central question ("of the people who ran an estimate, how many
-- saved?") was unanswerable. The client now stamps the same ids
-- (src/lib/session.js) on every event and on the submission body.
--
-- TWO ids, because one cannot answer both questions:
--   session_id — one per visit  → per-visit conversion (the funnel proper)
--   visitor_id — one per browser, never rotated → per-person conversion, and
--                what lets a return visit be tied to the estimate that person
--                ran last week
-- A single id silently mixes the two: someone who estimates Monday without
-- saving and returns Tuesday to save is 50% by visit and 100% by person.
--
-- Both nullable on purpose: rows written before this migration have none, and a
-- client with storage disabled may send null. A missing id must never block a
-- save.

alter table public.submissions
  add column if not exists session_id text,
  add column if not exists visitor_id text;

create index if not exists submissions_session_id_idx on public.submissions (session_id);
create index if not exists submissions_visitor_id_idx on public.submissions (visitor_id);
