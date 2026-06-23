// Pure parsing + fuzzy-matching for the AI recommendation response.
// Extracted from App.jsx getRecommendations() so the brittle bits — JSON
// fence stripping, shape validation, and name matching — can be tested
// without a live API call. Behavior matches the original inline code.

export function fuzzyMatchSchool(name, schools) {
  const exact = schools.find(s => s.name === name);
  if (exact) return name;
  const lower = name.toLowerCase();
  const close = schools.find(s => s.name.toLowerCase() === lower);
  if (close) return close.name;
  const partial = schools.find(s => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()));
  if (partial) return partial.name;
  return name; // keep original if no match found
}

// Takes the raw model text and returns either the parsed {reach,target,safety,...}
// object (with school names fuzzy-matched to the canonical list) or {error}.
export function parseRecommendations(rawText, schools) {
  const text = rawText || "";
  if (!text) {
    return { error: "Empty response from AI. Please try again." };
  }
  const clean = text.replace(/```json\s?|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    return { error: "Could not generate recommendations: " + (e.message || "Unknown error") };
  }
  if (!parsed.reach || !parsed.target || !parsed.safety) {
    return { error: "AI returned unexpected format. Please try again." };
  }
  for (const bucket of ["reach", "target", "safety"]) {
    if (Array.isArray(parsed[bucket])) {
      parsed[bucket] = parsed[bucket].map(s => ({ ...s, name: fuzzyMatchSchool(s.name, schools) }));
    }
  }
  return parsed;
}
