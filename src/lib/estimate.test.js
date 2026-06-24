import { describe, it, expect } from "vitest";
import { getTimingLabel, TIMING_PROFILES, seatsRemaining, scoreApplicant, estimateOutcomes, SOFTS_WEIGHT } from "./estimate.js";

// A representative T14 school (Yale-shaped) used as a fixture so these tests
// don't break when the real SCHOOLS data is edited.
const T14 = {
  name: "Test T14 Law", tier: "T14",
  median_lsat: 174, p25_lsat: 171, p75_lsat: 177,
  median_gpa: 3.96, p25_gpa: 3.90, p75_gpa: 4.00,
  tuition: 78600, pct_grant: 75, pct_half: 45, pct_full: 20,
  med_grant: 25000, p25_grant: 0, p75_grant: 55000,
  class_size: 220, yield: 0.77, seats_pct: 0.04,
  accept_rate: 0.0406, wl_rate: 0.05,
};

// A less selective school where a strong applicant clears the merit thresholds.
const REGIONAL = {
  name: "Test Regional Law", tier: "T100",
  median_lsat: 158, p25_lsat: 154, p75_lsat: 161,
  median_gpa: 3.50, p25_gpa: 3.30, p75_gpa: 3.70,
  tuition: 45000, pct_grant: 80, pct_half: 55, pct_full: 30,
  med_grant: 20000, p25_grant: 8000, p75_grant: 40000,
  class_size: 200, yield: 0.40, seats_pct: 0.20,
  accept_rate: 0.45, wl_rate: 0.12,
};

describe("getTimingLabel", () => {
  it("returns 'early' with no date", () => {
    expect(getTimingLabel("")).toBe("early");
    expect(getTimingLabel(null)).toBe("early");
    expect(getTimingLabel(undefined)).toBe("early");
  });

  it("maps each cycle window to its tier", () => {
    expect(getTimingLabel("2025-09-15")).toBe("early");
    expect(getTimingLabel("2025-10-15")).toBe("early");
    expect(getTimingLabel("2025-11-15")).toBe("ontime_early");
    expect(getTimingLabel("2025-12-15")).toBe("ontime");
    expect(getTimingLabel("2026-01-20")).toBe("ontime_late");
    expect(getTimingLabel("2026-02-14")).toBe("late");
    expect(getTimingLabel("2026-03-15")).toBe("very_late");
    expect(getTimingLabel("2026-06-15")).toBe("very_late");
  });

  it("falls back to 'early' for out-of-cycle years", () => {
    expect(getTimingLabel("2024-06-15")).toBe("early");
    expect(getTimingLabel("2027-06-15")).toBe("early");
  });

  // Regression: month-boundary dates must bucket by their literal month in the
  // string, not by whatever local timezone shifts them to. Previously these
  // rolled back a day (Mar 1 -> Feb, Jan 1 -> prior Dec) on US machines.
  it("buckets month-boundary dates correctly in any timezone", () => {
    expect(getTimingLabel("2025-11-01")).toBe("ontime_early");
    expect(getTimingLabel("2025-12-01")).toBe("ontime");
    expect(getTimingLabel("2026-01-01")).toBe("ontime_late");
    expect(getTimingLabel("2026-02-01")).toBe("late");
    expect(getTimingLabel("2026-03-01")).toBe("very_late");
    expect(getTimingLabel("2027-01-01")).toBe("early");
  });

  it("every label resolves to a defined timing profile", () => {
    for (const key of ["early", "ontime_early", "ontime", "ontime_late", "late", "very_late"]) {
      expect(TIMING_PROFILES[key]).toBeDefined();
    }
  });
});

describe("scoreApplicant", () => {
  it("scores an at-median applicant at ~0", () => {
    expect(scoreApplicant(3.96, 174, T14)).toBeCloseTo(0, 10);
  });

  it("scores above-median positive and below-median negative", () => {
    expect(scoreApplicant(4.0, 178, T14)).toBeGreaterThan(0);
    expect(scoreApplicant(3.5, 165, T14)).toBeLessThan(0);
  });
});

describe("seatsRemaining", () => {
  it("never goes negative", () => {
    expect(seatsRemaining(T14, "very_late")).toBeGreaterThanOrEqual(0);
  });

  it("drains as the cycle gets later", () => {
    expect(seatsRemaining(REGIONAL, "early")).toBeGreaterThanOrEqual(
      seatsRemaining(REGIONAL, "very_late")
    );
  });
});

describe("estimateOutcomes", () => {
  it("returns accept/waitlist/deny that always sum to 100", () => {
    for (const tk of Object.keys(TIMING_PROFILES)) {
      for (const [gpa, lsat] of [[4.0, 180], [3.7, 168], [3.2, 158], [2.9, 150]]) {
        const r = estimateOutcomes(gpa, lsat, T14, false, "average", tk);
        expect(r.accept + r.waitlist + r.deny).toBe(100);
        expect(r.accept).toBeGreaterThanOrEqual(0);
        expect(r.deny).toBeGreaterThanOrEqual(0);
        expect(r.waitlist).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives a strong applicant a much better shot than a weak one", () => {
    const strong = estimateOutcomes(4.0, 180, T14, false, "average", "early");
    const weak = estimateOutcomes(3.0, 150, T14, false, "average", "early");
    expect(strong.accept).toBeGreaterThan(weak.accept);
  });

  it("applies a timing penalty: later cycle lowers a T14 acceptance", () => {
    const early = estimateOutcomes(3.8, 172, T14, false, "average", "early");
    const late = estimateOutcomes(3.8, 172, T14, false, "average", "very_late");
    expect(early.accept).toBeGreaterThanOrEqual(late.accept);
    expect(late.admPenalty).toBeGreaterThan(early.admPenalty);
  });

  it("applies a timing penalty to scholarship dollars", () => {
    const early = estimateOutcomes(3.95, 178, REGIONAL, false, "average", "early");
    const late = estimateOutcomes(3.95, 178, REGIONAL, false, "average", "very_late");
    expect(early.estMax).toBeGreaterThanOrEqual(late.estMax);
  });

  it("URM and soft-factor boosts raise the adjusted score", () => {
    const base = estimateOutcomes(3.7, 168, T14, false, "average", "early");
    const boosted = estimateOutcomes(3.7, 168, T14, true, "excellent", "early");
    expect(boosted.score).toBeGreaterThan(base.score);
  });

  it("a top applicant at a generous school lands in a merit tier with real dollars", () => {
    const r = estimateOutcomes(3.95, 175, REGIONAL, false, "excellent", "early");
    expect(["Full Ride", "Strong Merit Aid"]).toContain(r.scholLabel);
    expect(r.estMax).toBeGreaterThan(0);
    expect(r.scholLikelihood).toBeGreaterThanOrEqual(2);
  });

  it("keeps scholarship likelihood within sane bounds", () => {
    for (const [gpa, lsat] of [[4.0, 180], [3.0, 150]]) {
      const r = estimateOutcomes(gpa, lsat, T14, false, "average", "early");
      expect(r.scholLikelihood).toBeGreaterThanOrEqual(2);
      expect(r.scholLikelihood).toBeLessThanOrEqual(92);
      expect(r.estMin).toBeGreaterThanOrEqual(0);
      expect(r.estMax).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("softs bucket weights (4-bucket remap)", () => {
  // score = scoreApplicant + SOFTS_WEIGHT[softs]; isolate the boost via score.
  const sc = (softs) => estimateOutcomes(3.7, 168, T14, false, softs, "early").score;

  it("maps each bucket to its weight relative to average", () => {
    const avg = sc("average");
    expect(sc("poor") - avg).toBeCloseTo(-0.05, 10);
    expect(sc("above_average") - avg).toBeCloseTo(0.10, 10);
    expect(sc("excellent") - avg).toBeCloseTo(0.18, 10);
  });

  // CRITICAL regression guard: the remap must NOT move the default-"average"
  // applicant. average boost is exactly 0 — identical to pre-4-bucket behavior.
  it("REGRESSION: average stays at baseline 0 (no drift from the remap)", () => {
    expect(SOFTS_WEIGHT.average).toBe(0);
    expect(sc("average")).toBeCloseTo(scoreApplicant(3.7, 168, T14), 10);
  });

  it("back-compat: legacy 'good' and any unknown/missing value map to 0", () => {
    const avg = sc("average");
    expect(sc("good")).toBeCloseTo(avg, 10);       // legacy value from an old shared URL
    expect(sc("whatever")).toBeCloseTo(avg, 10);
    expect(sc(undefined)).toBeCloseTo(avg, 10);
  });
});
