// POST /api/resume — classify the soft factors on an uploaded resume PDF.
//
// Upload contract: JSON { pdf_base64 } (NOT multipart — Vercel doesn't parse
// multipart, and base64-JSON sidesteps it). Raw file capped at ~3MB so the
// base64 payload (~+33%) stays under Vercel's 4.5MB body limit.
//
// Returns:
//   { ok: true,  bucket, reasons, bucket_source: "ai" }   on a clean read
//   { ok: false, fallback: true }                          on any unreadable/parse
//        failure (HTTP 200) so the client falls back to the manual dropdown and
//        the estimate is never blocked.
//
// PII rule: the resume is streamed to Anthropic and never persisted or logged.
// Error paths log status only — NEVER the request body or extracted text.

import { guard, dailyCapExceeded } from "./_guards.js";

const MODEL = "claude-sonnet-4-20250514"; // pinned: PDF-capable, stable
const BUCKETS = ["poor", "average", "above_average", "excellent"];
// ~3MB raw PDF after base64 inflation; keeps the JSON body under Vercel's 4.5MB.
const MAX_B64_CHARS = 4_200_000;

const SYSTEM = `You are an admissions reader scoring ONLY the soft factors on a law school applicant's resume. Soft factors = work experience, leadership, community involvement, publications, military/public service, and notable achievements. Ignore GPA and LSAT entirely.

Classify into EXACTLY one bucket:
- "poor": thin background; little or no work experience or notable activities.
- "average": standard profile; some experience/activities, nothing that stands out.
- "above_average": solid full-time work experience OR strong leadership / extracurriculars / publications.
- "excellent": T14-caliber softs; significant work experience, major leadership, notable achievements, publications, or exceptional/military service.

Be consistent and conservative. Respond with ONLY valid JSON, no markdown, no prose:
{"bucket":"poor|average|above_average|excellent","reasons":["short concrete phrase","..."]}
Give 2 to 4 reasons, each a short phrase citing what is (or isn't) on the resume, e.g. "3 years work experience", "led a 12-person team", "no publications".`;

export default async function handler(req, res) {
  const blocked = await guard(req);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error });

  let pdf_base64 = req.body?.pdf_base64;
  if (typeof pdf_base64 !== "string" || !pdf_base64.trim()) {
    return res.status(400).json({ error: "Missing pdf_base64" });
  }
  // Strip a data-URL prefix if the client sent one (data:application/pdf;base64,...).
  if (pdf_base64.startsWith("data:")) {
    const comma = pdf_base64.indexOf(",");
    if (comma !== -1) pdf_base64 = pdf_base64.slice(comma + 1);
  }
  pdf_base64 = pdf_base64.trim();

  if (pdf_base64.length > MAX_B64_CHARS) {
    return res.status(400).json({ error: "PDF too large — please keep it under 3MB." });
  }
  // PDF magic bytes "%PDF" → base64 begins "JVBER". Cheap server-side type check.
  if (!pdf_base64.startsWith("JVBER")) {
    return res.status(400).json({ error: "That file isn't a PDF — PDF only for now." });
  }

  // Charge the global daily budget right before the expensive vision call, so
  // requests rejected above don't burn it.
  if (await dailyCapExceeded()) {
    return res.status(429).json({ error: "Daily capacity reached. Pick your softs level manually, or try again tomorrow." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: 0,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf_base64 } },
            { type: "text", text: "Classify the soft factors on this resume." },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      console.error("Resume classify: Anthropic returned", resp.status); // status only — never the body
      return res.status(200).json({ ok: false, fallback: true });
    }

    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    const clean = text.replace(/```json\s?|```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch { parsed = null; }

    const bucket = parsed?.bucket;
    if (!BUCKETS.includes(bucket)) {
      return res.status(200).json({ ok: false, fallback: true });
    }
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((r) => typeof r === "string").slice(0, 4).map((r) => r.slice(0, 120))
      : [];

    return res.status(200).json({ ok: true, bucket, reasons, bucket_source: "ai" });
  } catch {
    console.error("Resume classify: unexpected error"); // no error object — it could echo the body
    return res.status(200).json({ ok: false, fallback: true });
  }
}
