import { guard, validateStats, dailyCapExceeded, capList, clampField, num } from "./_guards.js";

export default async function handler(req, res) {
  const blocked = await guard(req);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error });

  const apiKey = process.env.ANTHROPIC_API_KEY;

  try {
    const { gpa, lsat, urm, softs, timingKey, stateFilter, tuitionMax, schools } = req.body || {};

    if (!gpa || !lsat || !Array.isArray(schools) || schools.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const statErr = validateStats(gpa, lsat);
    if (statErr) return res.status(statErr.status).json({ error: statErr.error });

    if (await dailyCapExceeded()) {
      return res.status(429).json({ error: 'Daily capacity reached. AI features reset tomorrow.' });
    }

    const capped = capList(schools);
    const schoolList = capped.map(s =>
      `${clampField(s.name)}|${clampField(s.tier, 8)}|${clampField(s.city, 40)},${clampField(s.state, 4)}|acc${Math.round(num(s.accept_rate) * 100)}%|L${num(s.median_lsat)}|G${num(s.median_gpa)}|$${Math.round(num(s.tuition) / 1000)}k|grant$${Math.round(num(s.med_grant) / 1000)}k`
    ).join('\n');

    const stateF = stateFilter ? clampField(stateFilter, 30) : '';
    const tuitionF = num(tuitionMax);
    const filterNote = (stateF || tuitionF)
      ? `\nIMPORTANT FILTERS: ${stateF ? `Strongly prefer schools in ${stateF}.` : ''} ${tuitionF ? `Strongly prefer tuition under $${tuitionF.toLocaleString()}.` : ''} Prioritize schools matching these filters but include 1-2 non-matching schools per bucket if they are exceptionally strong fits.`
      : '';

    const system = 'You are an expert law school admissions counselor. You MUST respond with ONLY valid JSON. No markdown fences, no text before or after the JSON object. Keep all strings concise (under 25 words each).';
    const userMessage = `Student: GPA ${num(gpa).toFixed(2)}, LSAT ${num(lsat)}, URM: ${urm === true}, Softs: ${clampField(softs, 20)}, Timing: ${clampField(timingKey, 20)}.${filterNote}

Schools (name|tier|location|accept rate|med LSAT|med GPA|tuition|med grant):
${schoolList}

Return ONLY this JSON (no markdown, no backticks):
{"summary":"2-3 sentence overview","reach":[{"name":"exact school name","reason":"why reach","tip":"tactical tip"}],"target":[{"name":"exact school name","reason":"why target","tip":"tactical tip"}],"safety":[{"name":"exact school name","reason":"why safety","tip":"tactical tip"}]}
Pick 5 schools per bucket (15 total). Use exact school names from the list above.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
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
    console.error('Recommendations API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
