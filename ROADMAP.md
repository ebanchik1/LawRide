# ScholarshipIQ Roadmap

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

- Lane C: softs 4-bucket remap + regression guard *(in progress)*
- Lane B: `/api/resume` PDF → softs classification (base64-JSON, 3MB cap, never-log-body)
- Lane A: Supabase `submissions` table (surrogate PK, `bucket_source`, append-only)
- Lane D: frontend upload UI + email capture + override + fallback

**Gate before scaling it:** watch 5 real applicants use it (the assignment).

## Next — cheap, high-signal

**Analytics / event tracking (~1 hr).** `@vercel/analytics` is already installed;
add custom events: resume_uploaded, estimate_run, recommendations_run, returned.
This is how you stop *guessing* whether anyone uses it. Do this right after the
current build ships.

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

- ✅ Resume upload — designed + eng-reviewed (building now)
- ✅ Quality foundation — tests, lint, CI, timing-bug fix
- ✅ API security hardening (cost-abuse vectors closed)
- ✅ Mobile/UX polish
