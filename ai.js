// Tekoäly: Google Gemini (ilmainen kiintiö) tai mikä tahansa OpenAI-yhteensopiva rajapinta
// (esim. Groq tai OpenRouterin ilmaismallit). Avain tallennetaan vain tälle laitteelle.
import { TAGS } from './data.js';

export const AI_DEFAULTS = { provider: 'gemini', geminiModel: 'gemini-flash-latest', oaiBase: 'https://api.groq.com/openai/v1', oaiModel: 'llama-3.3-70b-versatile' };

export function aiReady(st) {
  if (st.provider === 'gemini') return !!st.geminiKey;
  if (st.provider === 'openai') return !!(st.oaiKey && st.oaiBase && st.oaiModel);
  return false;
}

function parseJSON(txt) {
  const t = (txt || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/[\[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Tekoäly palautti virheellistä dataa.');
  }
}

async function callGemini(st, system, user, temperature) {
  const model = st.geminiModel || AI_DEFAULTS.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(st.geminiKey)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw await apiError(res);
  const j = await res.json();
  const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!txt) throw new Error('Tekoäly ei palauttanut vastausta (mahdollisesti suodatettu).');
  return parseJSON(txt);
}

async function callOpenAI(st, system, user, temperature) {
  const res = await fetch(st.oaiBase.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.oaiKey}` },
    body: JSON.stringify({ model: st.oaiModel, temperature, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw await apiError(res);
  const j = await res.json();
  return parseJSON(j.choices?.[0]?.message?.content);
}

async function apiError(res) {
  let msg = '';
  try { const j = await res.json(); msg = j.error?.message || JSON.stringify(j).slice(0, 200); } catch { }
  if (res.status === 429) return new Error('Ilmaiskiintiö on täynnä hetkeksi. Odota minuutti tai jatka ilman tekoälyä.');
  if (res.status === 400 && /API key/i.test(msg)) return new Error('API-avain ei kelpaa. Tarkista se asetuksista.');
  if (res.status === 401 || res.status === 403) return new Error('API-avain ei kelpaa tai sillä ei ole oikeuksia.');
  if (res.status === 404) return new Error('Mallia ei löydy. Valitse malli asetuksista (Hae mallit).');
  return new Error(`Tekoälyvirhe ${res.status}: ${msg}`);
}

export async function aiJSON(st, system, user, temperature = 0.3) {
  if (!aiReady(st)) throw new Error('Tekoäly ei ole käytössä.');
  return st.provider === 'gemini' ? callGemini(st, system, user, temperature) : callOpenAI(st, system, user, temperature);
}

export async function listGeminiModels(key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
  if (!res.ok) throw await apiError(res);
  const j = await res.json();
  return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, '')).filter(n => /flash|pro|gemma/i.test(n) && !/image|tts|audio|live|embedding|robotics|computer/i.test(n));
}

const TAG_LIST = Object.keys(TAGS).join(', ');

function coach(ctx) {
  return `You are a demanding but fair English coach for a Finnish professional (L1 Finnish) who uses English at work every day.
Work context: ${ctx.workDesc || 'technical/industrial company; meetings, technical documentation, customer calls, emails'}.
Learner's current estimated level: ${ctx.level}. Goal: ${ctx.goal}. Weakest areas so far: ${ctx.weak || 'unknown'}.
Write ALL explanations in Finnish: short, direct, no praise or filler. Watch especially for errors typical of Finnish speakers: articles, prepositions, he/she (Finnish "hän"), present perfect vs past simple, future forms, question word order, uncountable nouns, missing "it/there" subject, and over-direct tone (missing politeness/hedging).
Error tags must be one of: ${TAG_LIST}.
Respond with JSON only.`;
}

const EVAL_SCHEMA = `{
 "score": integer 0-100 (calibration: 40 = hard to understand, 55 = understandable with many errors, 70 = clear with some errors, 85 = professional with minor slips, 95 = native-like),
 "cefr": "A2"|"B1"|"B2"|"C1"|"C2" (level shown by THIS text),
 "sub": {"grammar":0-100,"vocabulary":0-100,"clarity":0-100,"tone":0-100,"task":0-100},
 "errors": [{"orig":"exact substring copied from the learner's text","fix":"corrected version of that substring","tag":"one tag","why":"selitys suomeksi, max 15 sanaa"}],
 "improved": "the learner's text rewritten as natural professional English, keeping their content and length",
 "tip": "yksi konkreettinen kehitysvinkki suomeksi, max 25 sanaa"
}
List at most 8 errors, most important first. "orig" MUST be copied exactly from the learner's text so it can be found with a string search.`;

export async function evalWriting(st, ctx, item, text) {
  const user = `Task (given in Finnish): ${item.task}
Channel: ${item.ctx}. Expected minimum ${item.minWords} words.
Learner's text:
"""${text}"""
Evaluate grammar, word choice, clarity, tone (politeness appropriate for ${item.ctx}) and whether the task was completed. Return JSON:
${EVAL_SCHEMA}`;
  return aiJSON(st, coach(ctx), user);
}

export async function evalSpeaking(st, ctx, item, transcript, seconds) {
  const user = `Spoken task (given in Finnish): ${item.task}
The other person said: "${item.prompt}"
Learner's spoken answer, transcribed automatically by speech recognition (${Math.round(seconds)} s). Ignore punctuation, capitalisation and obvious transcription glitches; judge spoken grammar, vocabulary, structure, politeness and whether it answers the situation.
"""${transcript}"""
Return JSON:
${EVAL_SCHEMA}
In "improved" write what a fluent professional might naturally say, at a similar length.`;
  return aiJSON(st, coach(ctx), user);
}

export async function checkShort(st, ctx, item, answer) {
  const what = item.type === 'tr' ? `Translate into English: "${item.fi}"` : `Correct the error(s) in: "${item.wrong}"`;
  const user = `Exercise: ${what}
Reference answers: ${JSON.stringify(item.ans)}
Learner's answer: "${answer}"
Is the learner's answer correct, natural English that keeps the meaning? Minor stylistic differences are fine. Return JSON:
{"score": 0|0.5|1, "correct": "best corrected version of the learner's answer", "why": "lyhyt selitys suomeksi (max 20 sanaa); tyhjä jos oikein", "tag": "main error tag or empty"}`;
  return aiJSON(st, coach(ctx), user, 0.1);
}

export async function generateItems(st, ctx, { tags, level, rating, n = 6 }) {
  const user = `Create ${n} new practice exercises for this learner, focused on these weak areas: ${tags.join(', ')}.
Difficulty around CEFR ${level} (numeric difficulty ≈ ${rating}; scale: B1=1000-1200, B2=1200-1400, C1=1400-1600).
Use realistic sentences from the learner's work context. Mix types:
- "mcq": {"type":"mcq","q":"sentence with ___ gap","opts":[4 options],"a":index_of_correct,"ex":"selitys suomeksi"}
- "fix": {"type":"fix","wrong":"sentence with one typical Finnish-speaker error","ans":["correct version", "other acceptable versions"],"ex":"selitys suomeksi"}
- "tr": {"type":"tr","fi":"suomenkielinen lause","ans":["English translation","2-4 other acceptable translations"]}
Every item also needs "tags":[1-2 tags from the list] and "d": integer difficulty.
Exactly one option is correct in each mcq. Return JSON: {"items":[...]}`;
  const j = await aiJSON(st, coach(ctx), user, 0.8);
  const now = Date.now().toString(36);
  return (j.items || []).map((it, i) => {
    const base = { id: `g:${now}:${i}`, gen: true, created: Date.now(), d: Number(it.d) || rating, tags: (it.tags || []).filter(t => TAGS[t]) };
    if (it.type === 'mcq' && it.q && Array.isArray(it.opts) && it.opts.length >= 3 && Number.isInteger(it.a) && it.opts[it.a] != null) return { ...base, type: 'mcq', skill: 'grammar', q: it.q, opts: it.opts, a: it.a, ex: it.ex || '' };
    if (it.type === 'fix' && it.wrong && it.ans?.length) return { ...base, type: 'fix', skill: 'sentence', wrong: it.wrong, ans: it.ans, ex: it.ex || '' };
    if (it.type === 'tr' && it.fi && it.ans?.length) return { ...base, type: 'tr', skill: 'sentence', fi: it.fi, ans: it.ans };
    return null;
  }).filter(Boolean);
}
