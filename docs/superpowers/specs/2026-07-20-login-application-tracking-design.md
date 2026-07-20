# Login + Application Tracking — Design

**Date:** 2026-07-20
**Status:** Approved, ready for implementation plan
**Branch:** `feat/login-application-tracking`

## Goal

Turn LawRide from an anonymous calculator into a returning-user product by adding
magic-link login and a per-user application tracker. This is the roadmap's
"returning-user loop" — the real moat surface. Application tracking is value-first
(it helps applicants manage a stressful cycle); the outcome dataset that calibrates
the model falls out as a byproduct.

Login and tracking ship together because tracking requires auth.

## Decisions (locked)

- **Auth:** Supabase Auth, client-side, magic link. RLS keyed on `auth.uid()`.
- **Entry model:** optional & additive. The estimator stays 100% anonymous and
  unchanged. Login unlocks a "My Applications" area. On first login, prior
  anonymous submissions are adopted by matching email.
- **Tracker scope:** lean lifecycle. Per-school status
  (`interested → applied → accepted/waitlisted/rejected`), deadline, submitted
  date, scholarship offer, notes. Create from results cards or manually.
- **Reminders:** deferred. Visual urgency cues only; no reminder emails this build.

## Architecture

Client-side Supabase Auth coexists with the existing server-side service_role setup.

- **New browser Supabase client** — `src/lib/supabase.js`, a singleton created from
  two new *public* env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Vite
  exposes `VITE_`-prefixed vars to client code. The anon key is public by design;
  Row Level Security is what protects data.
- **Existing `api/_db.js`** (service_role) is untouched. The anonymous estimator,
  resume classify, and submit endpoints keep working exactly as they do now.
- **Magic link** via `supabase.auth.signInWithOtp({ email })`. supabase-js persists
  the session in localStorage and auto-parses the magic-link callback on page load
  (`detectSessionInUrl: true`), so the email redirect target is just the site root —
  no dedicated callback route is required.
- **Auth state** is exposed through a small `useAuth` hook: `{ user, session, loading,
  signIn(email), signOut() }`, backed by `supabase.auth.onAuthStateChange`.

### Module boundaries (isolation)

`App.jsx` is already ~1000 lines. New behavior goes into focused files rather than
growing it further. `App.jsx` only gains a gated "My Applications" tab and a "Track"
button on result cards.

| File | Purpose | Depends on |
|---|---|---|
| `src/lib/supabase.js` | Browser Supabase client singleton | env vars |
| `src/lib/useAuth.js` | Auth state hook (user/session/signIn/signOut/loading) | supabase.js |
| `src/lib/applications.js` | Data access: list/create/update/delete applications; pure helpers (status validation, deadline urgency, cents↔dollars) | supabase.js |
| `src/Tracker.jsx` | "My Applications" view | useAuth, applications.js, SCHOOLS |
| `src/components/LoginControl.jsx` | Email → magic-link UX; signed-in state | useAuth |

## Data model

### New migration `supabase/migrations/0002_applications.sql`

**`applications`** — the user's living tracker (mutable, per-user):

| column | type | notes |
|---|---|---|
| `id` | bigint identity | PK |
| `user_id` | uuid | `references auth.users(id)`, NOT NULL |
| `school_name` | text | NOT NULL |
| `status` | text | check in (`interested`,`applied`,`accepted`,`waitlisted`,`rejected`); default `interested` |
| `deadline` | date | nullable |
| `submitted_date` | date | nullable |
| `scholarship_offer_cents` | integer | nullable; money stored as cents, displayed as $ |
| `notes` | text | nullable |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now(); kept current by a `before update` trigger so it is correct regardless of write path |

Indexes: `(user_id)`, `(user_id, status)`.

**RLS:** enabled, with four policies — select/insert/update/delete — each
`using (user_id = auth.uid())` (and `with check (user_id = auth.uid())` on
insert/update). Full per-user CRUD enforced at the database.

### Change to `submissions` (same migration)

- Add nullable `user_id uuid references auth.users(id)`.
- Add a SELECT RLS policy `using (user_id = auth.uid())` so a logged-in user can read
  their own past saves (needed for the import). The existing service_role write path
  is unchanged (service_role bypasses RLS).

## Adoption / import on first login

A single **authenticated** endpoint, `POST /api/import-submissions`, run once when a
user logs in. It verifies the caller's Supabase JWT server-side (Authorization:
Bearer), resolves the verified email, then uses service_role to — idempotently:

1. Stamp `submissions.user_id` on rows where `email` matches the verified user's email
   and `user_id is null` (backfills ownership → aids calibration).
2. Insert `applications` rows (status `interested`) for the distinct schools drawn
   from those submissions, skipping any the user already tracks — so a returning
   user's tracker is pre-populated instead of empty.

Idempotent: safe to call on every login; a second run is a no-op.

## UI / UX

- **Login control** (header): enter email → "Check your inbox for a magic link"
  state. When signed in, shows the email + "Sign out."
- **"My Applications" tab** — visible only when signed in — renders `Tracker.jsx`:
  a list of tracked schools. Each row has a status dropdown, deadline with an urgency
  cue ("due in 5 days" amber; "overdue" red), a scholarship-offer field, notes, and
  delete. An "Add a school" control searches the existing `SCHOOLS` list or accepts a
  free-typed name.
- **"Track" button** on estimator and recommendation result cards (shown when signed
  in) → creates an `interested` application prefilled with that school, without
  leaving results.
- The existing anonymous "Save results / email capture" is unchanged for logged-out
  users.

## Error handling

- Logged-out app works fully; nothing about auth blocks the estimator.
- Magic-link request errors, expired links, and DB errors show a soft inline message
  and degrade gracefully.
- The import endpoint is idempotent; a failed import never blocks using the tracker.
- RLS guarantees a user can only ever read/write their own rows.

## Security

- RLS is the enforcement boundary; the anon key shipped to the browser is safe by
  design.
- `POST /api/import-submissions` verifies the Supabase JWT before performing any
  service_role write; it only ever operates on the verified caller's own email.
- No PII is logged (consistent with existing endpoints — codes/status only).

## Testing

- Unit tests (vitest) for the pure logic in `applications.js`: status-set validation,
  deadline-urgency computation, and cents↔dollars formatting, mocking the supabase
  client.
- The full magic-link auth flow is validated manually, consistent with the current
  test scope (the existing suite unit-tests pure logic, not network/DB integration).

## Out of scope (explicit)

- Deadline reminder emails (needs cron + email provider) — later build.
- Custom SMTP for branded magic-link emails — a production follow-up; Supabase's
  built-in email is sufficient for MVP/validation.
- Richer application lifecycle (interview/deferred/withdrawn states, seat-deposit
  deadlines, negotiation tracking).

## Deferred config / ops (not code, but required to ship)

- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel.
- Run migrations `0001` and `0002` against the prod Supabase project.
- Configure the magic-link redirect URL / allowed redirect list in Supabase Auth
  settings to the production origin.
