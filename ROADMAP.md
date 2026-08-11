# LawRide Roadmap

Sequenced by what builds the **moat** (a proprietary, timing-calibrated outcome
dataset + returning users) and what answers the **open question** (does anyone
actually use this). Not by novelty.

## The through-line

Four backlog items are not separate features — they're one arc, and the arc is
the moat:

```
resume softs + email capture   →   login / accounts   →   application tracking   →   calibrate from outcomes
   (building now)                     (v2)                  (value-first outcome engine)   (median-trend var, weight tuning)
```

Analytics runs alongside the whole path, telling you if anyone is walking it.
Aggregating competitors' data (Spivey/7Sage) sits *outside* the arc — a distraction.

---

## Now — current build (eng-reviewed, locked)

**Resume-analyzed softs + outcome capture.** See the design doc:
`~/.gstack/projects/ebanchik1-scholarshipiq/elibanchik-main-design-20260623-151952.md`

- Lane C: softs 4-bucket remap + regression guard ✅
- Lane B: `/api/resume` PDF → softs classification (base64-JSON, 3MB cap, never-log-body) ✅
- Lane A: Supabase `submissions` table (surrogate PK, `bucket_source`, append-only) ✅
- Lane D: frontend upload UI + email capture + override + fallback ✅

**Gate before scaling it:** watch 5 real applicants use it (the assignment).

## Next — run the gate

**Correction to the previous version of this doc**, which claimed the gate was
already measurable because custom events were live. It wasn't, for three
reasons — all now fixed:

1. **The email capture fired no event at all.** `saveResults()` called
   `/api/submit` and set component state, and that was it. The single
   conversion the whole moat depends on was the one step with no
   instrumentation, so estimate → save could not be computed.
2. **`/api/submit` shared the AI rate-limit bucket and required
   `ANTHROPIC_API_KEY`.** A normal session (resume + estimate + strategy +
   recommendations + a retry) could exhaust the 10/min allowance and then 429
   the save. In the UI that surfaced as a generic error, so a rate-limited save
   and a user declining to hand over an email looked identical in the data.
3. **Vercel Web Analytics cannot be the source of truth.** Custom events are
   unavailable on Hobby entirely, capped at 2 properties on Pro, and retained
   for one month on Hobby. Funnel events now go to our own Supabase `events`
   table; Vercel still gets a name-only ping as a convenience dashboard.

Live now: `session_start`, `returned`, `estimate_run`, `recommendations_run`,
`resume_attempted`, `resume_uploaded`, `resume_failed`, `save_attempted`,
`save_succeeded`, `save_failed` — every failure carrying a machine-readable
reason, every event carrying both a per-visit `session_id` and a per-person
`visitor_id` so per-visit and per-person conversion stay separable. `submissions`
carries the same ids, so events and rows are one SQL join.

**What's left here is still not code: watch 5 real applicants use it.** The
queries to read while doing it are at the bottom of
`supabase/migrations/0003_events.sql`. Before trusting any conversion number,
check the `save_failed` reason breakdown — if `rate_limited` or `not_configured`
appears at all, you're measuring infrastructure, not the product.

## Then — the returning-user loop (the real moat surface)

**Login (magic-link) + Application tracking, shipped together.**
- **Login:** magic-link on the email you're already capturing. Turns anonymous
  capture into real accounts.
- **Application tracking:** the sleeper hit. Let users track where they applied,
  deadlines, decisions, scholarship offers — *because it helps them manage a
  stressful cycle.* The outcome data that calibrates your model falls out as a
  byproduct. Value-first instead of harvest-first. This is the full expression of
  the `submissions` table.

These two are the same product surface; build them together.

## Later — calibration phase (only once outcomes exist)

**YoY median-trend variable.** Real phenomenon (medians creep up as schools get
more selective), but adding another *reasoned* coefficient before you can validate
it is the false-precision trap. Add it when the outcome dataset can tell you the
*real* trend — not a guessed one. Same for re-tuning the softs/timing weights.

## Deprioritized

**Aggregate Spivey / 7Sage / LSD data into strategy.** Defer, and be careful. The
AI already cites their methodology. Actually *integrating* their data means
scraping/licensing (freshness, ToS, legal) and makes you a data *aggregator* —
the opposite of your moat, which is *your* timing-calibrated outcome data nobody
else has. Skip unless a dataset is both free and uniquely additive.

## Done

- ✅ Resume-analyzed softs + outcome capture — all 4 lanes shipped (resume classify, `/api/submit`, 4-bucket remap, upload/email UI)
- ✅ Analytics event tracking — `resume_uploaded`, `estimate_run`, `recommendations_run`, `returned`
- ✅ Gate instrumentation — save/resume funnel events with failure reasons, own
  `events` table (Vercel custom events don't work on Hobby), `/api/submit`
  decoupled from the AI rate limiter, per-visit + per-person correlation ids
- ✅ Quality foundation — tests, lint, CI, timing-bug fix
- ✅ API security hardening (cost-abuse vectors closed)
- ✅ Mobile/UX polish
