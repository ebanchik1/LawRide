import { describe, it, expect } from "vitest";
import { fuzzyMatchSchool, parseRecommendations } from "./recommendations.js";

const SCHOOLS = [
  { name: "Yale Law School" },
  { name: "Stanford Law School" },
  { name: "University of Chicago Law" },
];

describe("fuzzyMatchSchool", () => {
  it("returns the canonical name on an exact match", () => {
    expect(fuzzyMatchSchool("Yale Law School", SCHOOLS)).toBe("Yale Law School");
  });

  it("matches case-insensitively", () => {
    expect(fuzzyMatchSchool("yale law school", SCHOOLS)).toBe("Yale Law School");
  });

  it("matches a partial / shortened name", () => {
    expect(fuzzyMatchSchool("Yale", SCHOOLS)).toBe("Yale Law School");
    expect(fuzzyMatchSchool("Stanford Law School (CA)", SCHOOLS)).toBe("Stanford Law School");
  });

  it("keeps the original string when nothing matches", () => {
    expect(fuzzyMatchSchool("Hogwarts School of Law", SCHOOLS)).toBe("Hogwarts School of Law");
  });
});

describe("parseRecommendations", () => {
  const valid = JSON.stringify({
    summary: "A balanced list.",
    reach: [{ name: "Yale", reason: "r", tip: "t" }],
    target: [{ name: "University of Chicago Law", reason: "r", tip: "t" }],
    safety: [{ name: "Stanford", reason: "r", tip: "t" }],
  });

  it("errors on empty input", () => {
    expect(parseRecommendations("", SCHOOLS).error).toMatch(/empty/i);
    expect(parseRecommendations(null, SCHOOLS).error).toMatch(/empty/i);
  });

  it("parses clean JSON and fuzzy-matches names in every bucket", () => {
    const r = parseRecommendations(valid, SCHOOLS);
    expect(r.error).toBeUndefined();
    expect(r.reach[0].name).toBe("Yale Law School");
    expect(r.target[0].name).toBe("University of Chicago Law");
    expect(r.safety[0].name).toBe("Stanford Law School");
  });

  it("strips ```json code fences before parsing", () => {
    const fenced = "```json\n" + valid + "\n```";
    const r = parseRecommendations(fenced, SCHOOLS);
    expect(r.error).toBeUndefined();
    expect(r.reach[0].name).toBe("Yale Law School");
  });

  it("errors on malformed JSON", () => {
    expect(parseRecommendations("{not valid json", SCHOOLS).error).toMatch(/could not generate/i);
  });

  it("errors when a required bucket is missing", () => {
    const missing = JSON.stringify({ reach: [], target: [] }); // no safety
    expect(parseRecommendations(missing, SCHOOLS).error).toMatch(/unexpected format/i);
  });
});
