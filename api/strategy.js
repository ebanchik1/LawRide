import { guard, validateStats, dailyCapExceeded, capList, clampField, num } from "./_guards.js";

export default async function handler(req, res) {
  const blocked = await guard(req);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  try {
    const { gpa, lsat, urm, softs, timingLabel, results } = req.body || {};

    if (!gpa || !lsat || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const statErr = validateStats(gpa, lsat);
    if (statErr) return res.status(statErr.status).json({ error: statErr.error });

    if (await dailyCapExceeded()) {
      return res.status(429).json({ error: 'Daily capacity reached. AI features reset tomorrow.' });
    }

    const capped = capList(results);
    const timingNote = timingLabel ? `Application date timing: ${clampField(timingLabel, 40)}` : 'No date provided';
    const summary = capped.map(r =>
      `${clampField(r.name)}: Accept ${num(r.accept)}% / WL ${num(r.waitlist)}% / Deny ${num(r.deny)}% | Schol: ${clampField(r.scholLabel, 40)} ~${num(r.scholLikelihood)}% / $${num(r.estMin)}-$${num(r.estMax)} | Seats: ~${num(r.seats)}`
    ).join('\n');

    const system = 'You are a top law school admissions counselor. Give 3-4 sentences of sharp, actionable strategy. Reference specific schools by name. Prioritize timing urgency if relevant. No filler.';
    const userMessage = `GPA:${num(gpa)} LSAT:${num(lsat)} URM:${urm === true} Softs:${clampField(softs, 20)}\n${timingNote}\n2025-26 cycle: apps up 23% nationally. March 2026 - many T14s near class capacity.\n\n${summary}\n\nGive strategic insight covering admission positioning, waitlist strategy, and scholarship leverage.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(response.status).json({ error: `API error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Strategy API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
