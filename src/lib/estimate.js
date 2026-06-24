// Pure scoring + estimation logic for ScholarshipIQ.
// Extracted from App.jsx so it can be unit-tested in isolation.
// IMPORTANT: behavior must stay identical to the original App.jsx code —
// these functions back the live predictions people make real decisions on.

export function getTimingLabel(d) {
  if (!d) return "early";
  // Parse the YYYY-MM-DD string directly. Using `new Date(d)` parses the value
  // as UTC midnight but `.getMonth()` reads it in local time, so a US-timezone
  // user picking the 1st of a month gets bucketed into the previous month
  // (e.g. Mar 1 -> February). Reading the parts is timezone-proof.
  const parts = String(d).split("-");
  const y = Number(parts[0]); const m = Number(parts[1]);
  if (!y || !m) return "early";
  if (y===2025) { if (m<=10) return "early"; if (m===11) return "ontime_early"; if (m===12) return "ontime"; }
  if (y===2026) { if (m===1) return "ontime_late"; if (m===2) return "late"; if (m>=3) return "very_late"; }
  return "early";
}

export const TIMING_PROFILES = {
  early:       { label:"Early (Sep–Oct)",       color:"#4ade80", admPenalty:0,    scholPenalty:0,    wlShift: 0,    desc:"Optimal window — full scholarship budget, most seats open." },
  ontime_early:{ label:"On-Time (Nov)",          color:"#a3e635", admPenalty:0.08, scholPenalty:0.10, wlShift: 0.01, desc:"Strong timing. Slightly fewer top scholarship dollars than Sep-Oct." },
  ontime:      { label:"On-Time (Dec)",          color:"#facc15", admPenalty:0.15, scholPenalty:0.18, wlShift: 0.02, desc:"Acceptable for most schools, but prime scholarship funds thinning." },
  ontime_late: { label:"On-Time/Late (Jan)",     color:"#fb923c", admPenalty:0.22, scholPenalty:0.28, wlShift: 0.03, desc:"T14 scholarship budgets significantly allocated. Some schools near quota." },
  late:        { label:"Late (Feb)",             color:"#f97316", admPenalty:0.32, scholPenalty:0.42, wlShift: 0.05, desc:"Meaningfully reduced odds. Scholarship pool depleted at T14s." },
  very_late:   { label:"Very Late (Mar+)",       color:"#ef4444", admPenalty:0.42, scholPenalty:0.58, wlShift: 0.07, desc:"March+ applications face stiff headwinds. Several schools near capacity." },
};

export function seatsRemaining(school, tk) {
  const drain = { early:0, ontime_early:0.04, ontime:0.08, ontime_late:0.14, late:0.22, very_late:0.34 };
  const pct = Math.max(0, school.seats_pct - (drain[tk]||0));
  return Math.max(0, Math.round(pct * (school.class_size / school.yield)));
}

export function scoreApplicant(gpa, lsat, school) {
  return ((gpa - school.median_gpa)/0.12 + (lsat - school.median_lsat)/3.5) / 2;
}

// Soft-factor buckets → score boost. Resume classification or the manual
// dropdown sets one of these keys. Anything unrecognized — including the legacy
// "good" value from an old shared URL — maps to 0 (neutral) for back-compat.
// "average" stays 0 (= the pre-4-bucket baseline) so the remap introduces no
// systematic drift; "poor" can lower the number, so the override must be clear.
export const SOFTS_WEIGHT = { poor: -0.05, average: 0, above_average: 0.10, excellent: 0.18 };

export function estimateOutcomes(gpa, lsat, school, urm, softs, tk) {
  const timing = TIMING_PROFILES[tk] || TIMING_PROFILES.early;
  const base = scoreApplicant(gpa, lsat, school);
  const boost = (urm ? 0.35 : 0) + (SOFTS_WEIGHT[softs] ?? 0);
  const adj = base + boost;
  const isT14 = school.tier === "T14" || school.tier === "T25";
  const admPenalty = isT14 ? timing.admPenalty : timing.admPenalty * 0.35;
  const scholPenalty = timing.scholPenalty;

  const rawAccept = school.accept_rate;
  const statsMult = adj >= 1.5 ? 5.5 : adj >= 1.0 ? 4.5 : adj >= 0.5 ? 3.0 : adj >= 0.0 ? 2.0 : adj >= -0.5 ? 1.0 : adj >= -1.0 ? 0.45 : 0.18;
  let pAccept = Math.min(0.94, rawAccept * statsMult);
  pAccept = pAccept * (1 - admPenalty);

  const baseWL = school.wl_rate;
  let wlMult = adj >= 1.0 ? 0.2 : adj >= 0.3 ? 0.6 : adj >= -0.3 ? 1.4 : adj >= -0.8 ? 1.2 : 0.6;
  let pWL = Math.min(0.40, baseWL * wlMult + timing.wlShift);
  if (school.seats_pct < 0.05 && tk === "very_late") pWL = Math.min(0.45, pWL * 1.4);

  const pAcceptCapped = Math.min(pAccept, 1 - pWL);
  const pDeny = Math.max(0.02, 1 - pAcceptCapped - pWL);
  const total = pAcceptCapped + pWL + pDeny;
  const accept = Math.round((pAcceptCapped / total) * 100);
  const waitlist = Math.round((pWL / total) * 100);
  const deny = 100 - accept - waitlist;

  let scholLabel, scholColor, scholEmoji, scholLikelihood, estMin, estMax;
  const t = school.tuition;
  if (adj >= 1.4) {
    scholLabel="Full Ride"; scholColor="#34d399"; scholEmoji="🏆";
    scholLikelihood = Math.min(92, Math.round(school.pct_full * 3.2));
    estMin = t*0.85; estMax = t*1.05;
  } else if (adj >= 0.7) {
    scholLabel="Strong Merit Aid"; scholColor="#4ade80"; scholEmoji="⭐";
    scholLikelihood = Math.min(78, Math.round(school.pct_half * 1.5));
    estMin = t*0.45; estMax = t*0.85;
  } else if (adj >= 0.15) {
    scholLabel="Partial Scholarship"; scholColor="#fbbf24"; scholEmoji="🎓";
    scholLikelihood = Math.min(60, Math.round(school.pct_grant * 0.75));
    estMin = school.p25_grant; estMax = school.p75_grant;
  } else if (adj >= -0.4) {
    scholLabel="Small Aid Possible"; scholColor="#fb923c"; scholEmoji="💡";
    scholLikelihood = Math.min(35, Math.round(school.pct_grant * 0.35));
    estMin = school.p25_grant * 0.3; estMax = school.p25_grant * 1.1;
  } else {
    scholLabel="Unlikely"; scholColor="#f87171"; scholEmoji="📋";
    scholLikelihood = 8; estMin = 0; estMax = 0;
  }
  scholLikelihood = Math.max(2, Math.round(scholLikelihood * (1 - admPenalty)));
  estMin = Math.round(estMin * (1 - scholPenalty));
  estMax = Math.round(estMax * (1 - scholPenalty));

  const gpaPos = gpa >= school.p75_gpa ? "Above 75th ▲" : gpa >= school.median_gpa ? "Above Median" : gpa >= school.p25_gpa ? "Below Median" : "Below 25th ▼";
  const lsatPos = lsat >= school.p75_lsat ? "Above 75th ▲" : lsat >= school.median_lsat ? "Above Median" : lsat >= school.p25_lsat ? "Below Median" : "Below 25th ▼";

  return { accept, waitlist, deny, scholLabel, scholColor, scholEmoji, scholLikelihood, estMin, estMax, gpaPos, lsatPos, score: adj, admPenalty, scholPenalty, seats: seatsRemaining(school, tk), timing };
}
