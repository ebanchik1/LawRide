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

### 3. Add your API key

In Vercel dashboard → your project → Settings → Environment Variables:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (from console.anthropic.com) |

### 4. Deploy

Vercel auto-deploys on push. Your app will be live at `yourproject.vercel.app`.

### 5. Custom domain (optional)

In Vercel dashboard → Settings → Domains → add your domain and update DNS.

## Local development

```bash
npm install
cp .env.example .env.local  # Add your API key
npm run dev
```

Note: The `/api/strategy` and `/api/recommendations` serverless functions only work on Vercel. For local dev, the AI features won't work but the core estimator runs fine.

## Project structure

```
lawride/
├── api/
│   ├── strategy.js          # Vercel serverless: proxies AI strategy calls
│   └── recommendations.js   # Vercel serverless: proxies AI recommendation calls
├── src/
│   ├── App.jsx              # Main app component (all logic + UI)
│   └── main.jsx             # React entry point
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
