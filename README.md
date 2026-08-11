# LawRide

Law school admissions + scholarship estimator with AI-powered recommendations. Timing-adjusted acceptance, waitlist, and scholarship probability estimates across ABA-accredited schools, based on 2025 ABA 509 data — so you know what you'll get before you apply too late.

## Quick deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create lawride --public --push
```

Or create a repo manually at github.com/new and push.

### 2. Connect to Vercel

- Go to [vercel.com/new](https://vercel.com/new)
- Import your GitHub repo
- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

### 3. Add environment variables

In Vercel dashboard → your project → Settings → Environment Variables.

**Every one of these fails silently when missing** — deliberately, so a
misconfigured deploy degrades rather than erroring at users. That also makes
them easy to forget, so the consequence of omitting each is spelled out:

| Key | Needed for | If missing |
|-----|-----------|------------|
| `ANTHROPIC_API_KEY` | `/api/strategy`, `/api/recommendations`, `/api/resume` | Those three 500. Estimator still works; resume falls back to the manual dropdown. |
| `SUPABASE_URL` | `/api/submit`, `/api/event` | **Every save and every analytics event is silently discarded.** Nothing visibly breaks — you just collect no data. |
| `SUPABASE_SERVICE_ROLE_KEY` | same | same |
| `UPSTASH_REDIS_REST_URL` | rate limiting + AI spend cap | Per-IP limiting degrades to a per-instance window that resets on cold start, and the daily cap becomes a no-op. Nothing meaningfully caps API spend. |
| `UPSTASH_REDIS_REST_TOKEN` | same | same |
| `AI_DAILY_CALL_CAP` | optional | Defaults to 3000/day. Only enforced when Upstash is configured. |

Use the Supabase **service role** key, not the anon key: `submissions` and
`events` run RLS with no policies, so only service_role can write. It is read
solely in `api/_db.js` and never reaches the client.

Add Upstash via the Vercel Marketplace Redis integration — it sets both keys for
you.

### 4. Apply database migrations

Run the files in `supabase/migrations/` in order, in the Supabase SQL editor.
They're idempotent, so re-running is safe. Skipping them means `/api/submit` and
`/api/event` write to tables or columns that don't exist — and, per above, fail
silently when they do.

### 5. Deploy

Vercel auto-deploys on push. Your app will be live at `yourproject.vercel.app`.

After the first deploy, **verify the data path end to end**: run an estimate,
save it with your own email, then check `select count(*) from submissions;` in
Supabase. A zero there means the app looks fine and is recording nothing.

### 6. Custom domain (optional)

In Vercel dashboard → Settings → Domains → add your domain and update DNS.

## Local development

```bash
npm install
cp .env.example .env.local  # Fill in your keys
npm run dev
npm test                    # unit tests
npm run lint
```

Note: everything under `api/` is a Vercel serverless function and does not run
under `npm run dev`. Locally the AI features, saving, and analytics are all
inert — the core estimator runs fine. Use a Vercel preview deploy to exercise
the full data path.

## Project structure

```
lawride/
├── api/
│   ├── _db.js               # Supabase service-role client (server-only)
│   ├── _guards.js           # Rate limiting, spend cap, input sanitization
│   ├── strategy.js          # AI strategy proxy
│   ├── recommendations.js   # AI recommendations proxy
│   ├── resume.js            # Resume PDF → softs classification
│   ├── submit.js            # Save a submission (email capture)
│   └── event.js             # Funnel telemetry → events table
├── src/
│   ├── App.jsx              # Main app component (all logic + UI)
│   ├── SchoolPage.jsx       # /school/:slug detail page
│   ├── schools.js           # 184-school dataset (ABA 509)
│   ├── main.jsx             # React entry point + routes
│   └── lib/
│       ├── estimate.js      # Pure scoring/estimation logic (tested)
│       ├── recommendations.js # AI response parsing + fuzzy matching (tested)
│       ├── session.js       # Per-visit + per-person correlation ids (tested)
│       └── analytics.js     # Event transport (tested)
├── supabase/migrations/     # Run these in the Supabase SQL editor, in order
├── index.html               # HTML shell
├── vite.config.js           # Vite config
├── vercel.json              # Vercel routing + function config
└── package.json
```

## Data sources

- 2025 ABA Standard 509 Required Disclosures
- LSD.law 2025-26 cycle historical data
- Spivey Consulting 2025 median tracker
- School websites (grant/scholarship data)

## Cost

- **Vercel**: Free tier covers most usage (100GB bandwidth, 100hr serverless)
- **Anthropic API**: ~$0.003-0.01 per recommendation/strategy call (Sonnet pricing)
- At 1,000 users/day with AI features, expect ~$10-30/month API costs
