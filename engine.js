// Oppimismoottori: taitoluokitus (Elo), trendit, virhepankki (kertaus),
// päivän suunnitelma ja adaptiivinen tasotesti.
import { BANK, TAGS } from './data.js';

export const SKILLS = {
  grammar: 'Kielioppi',
  sentence: 'Lauseenmuodostus',
  writing: 'Kirjoittaminen',
  speaking: 'Puhuminen',
  fluency: 'Sujuvuus',
};
// Lähtöoletus: ymmärtäminen hyvä, tuottaminen hitaampaa
export const PRIOR = { grammar: 1150, sentence: 1100, writing: 1050, speaking: 1050, fluency: 1000 };
export const BANDS = [
  { l: 'A2', min: 0, max: 1000 }, { l: 'B1', min: 1000, max: 1200 }, { l: 'B2', min: 1200, max: 1400 },
  { l: 'C1', min: 1400, max: 1600 }, { l: 'C2', min: 1600, max: 1800 },
];
export const GOAL_RATING = { B1: 1100, B2: 1300, C1: 1500 };
const DAY = 864e5;
const SRS_STEPS = [1, 3, 7, 14, 30]; // päivää
const OBJECTIVE = new Set(['mcq', 'order', 'fix', 'tr']);
export const TEST_INTERVAL_DAYS = 14;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function cefr(r) {
  const b = BANDS.find(b => r < b.max) || BANDS[BANDS.length - 1];
  const frac = clamp((r - b.min) / (b.max - b.min), 0, 1);
  const sub = b.l === 'A2' ? '' : frac < 0.34 ? '' : frac < 0.67 ? '' : '+';
  return { level: b.l, label: b.l + sub, frac };
}
export const expected = (r, d) => 1 / (1 + 10 ** ((d - r) / 400));
const kFor = (n, test) => test ? Math.max(48, 160 / Math.sqrt(1 + n)) : Math.max(18, 72 / Math.sqrt(1 + n / 8));

export function emptyState() {
  return { v: 1, created: Date.now(), profile: { workDesc: '', goal: 'B2', minutes: 15, updatedAt: 0 }, attempts: [], tests: [], gen: [], plan: null, updatedAt: Date.now() };
}

// ---- Tekstin vertailu ----
const CONTR = [[/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'],
  [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'ve\b/g, ' have'], [/'ll\b/g, ' will'], [/'d\b/g, ' would'], [/\bi'm\b/g, 'i am'],
  [/\b(it|that|there|what|he|she|who|here)'s\b/g, '$1 is'], [/apologise/g, 'apologize'], [/organis/g, 'organiz'], [/analys(e|ed|ing)\b/g, 'analyz$1'], [/favour/g, 'favor']];
export function norm(s) {
  let x = (s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
  for (const [re, rep] of CONTR) x = x.replace(re, rep);
  return x.replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function bestMatch(answer, accepted) {
  const a = norm(answer).split(' ').filter(Boolean);
  let best = { sim: 0, ans: accepted[0] };
  for (const acc of accepted) {
    const b = norm(acc).split(' ').filter(Boolean);
    const sim = 1 - lev(a, b) / Math.max(a.length, b.length, 1);
    if (sim > best.sim) best = { sim, ans: acc };
  }
  return best;
}

// ---- Tila → johdetut tiedot (toistetaan tapahtumaloki, joten synkronoinnin yhdistäminen on turvallista) ----
export function derive(state) {
  const sk = {};
  for (const s in PRIOR) sk[s] = { r: PRIOR[s], n: 0, hist: [] };
  const tags = {};
  const srs = {};
  const personal = {};
  const events = [
    ...state.attempts.map(a => ({ ...a, _k: 'a' })),
    ...state.tests.map(t => ({ ...t, _k: 't' })),
  ].sort((a, b) => a.t - b.t);

  for (const e of events) {
    if (e._k === 't') {
      for (const [s, est] of Object.entries(e.est || {})) {
        if (!sk[s] || est == null) continue;
        sk[s].r = e.placement ? est : Math.round(0.35 * sk[s].r + 0.65 * est);
        sk[s].n += 3;
        sk[s].hist.push({ t: e.t, r: sk[s].r, test: true });
      }
      continue;
    }
    for (const u of e.u || []) {
      const S = sk[u.s]; if (!S) continue;
      const p = expected(S.r, u.d);
      S.r = Math.round(S.r + kFor(S.n, false) * (u.score - p));
      S.n++;
      S.hist.push({ t: e.t, r: S.r });
    }
    for (const tg of e.tags || []) {
      const T = tags[tg] || (tags[tg] = { acc: 0.7, n: 0, last: 0 });
      T.acc = T.n ? T.acc * 0.75 + e.score * 0.25 : (0.7 + e.score) / 2;
      T.n++; T.last = e.t;
    }
    for (const [i, er] of (e.fb?.errors || []).entries()) {
      if (er.tag && TAGS[er.tag]) {
        const T = tags[er.tag] || (tags[er.tag] = { acc: 0.7, n: 0, last: 0 });
        T.acc = T.acc * 0.85; T.n++; T.last = e.t;
      }
      // Oma virhe → henkilökohtainen korjaustehtävä kertaukseen
      if (er.orig && er.fix && norm(er.orig) !== norm(er.fix) && er.orig.length < 220) {
        const id = `pe:${e.id}:${i}`;
        personal[id] = { id, type: 'fix', skill: 'sentence', personal: true, d: e.u?.[0]?.d || 1150, tags: er.tag ? [er.tag] : [], wrong: er.orig, ans: [er.fix], ex: er.why || '' };
        if (!srs[id]) srs[id] = { box: 0, due: e.t + DAY };
      }
    }
    if (OBJECTIVE.has(e.type) && e.itemId) {
      const cur = srs[e.itemId];
      if (!cur) { if (e.score < 0.6) srs[e.itemId] = { box: 0, due: e.t + DAY }; }
      else if (e.score >= 0.6) {
        cur.box++;
        if (cur.box >= SRS_STEPS.length) delete srs[e.itemId];
        else cur.due = e.t + SRS_STEPS[cur.box] * DAY;
      } else { cur.box = 0; cur.due = e.t + DAY; }
    }
  }

  // Trendi: lineaarinen regressio viimeisten 28 päivän luokituksista → muutos / viikko
  const now = Date.now();
  for (const s in sk) {
    const pts = sk[s].hist.filter(h => h.t > now - 28 * DAY);
    sk[s].trend = slopePerWeek(pts);
    sk[s].cefr = cefr(sk[s].r);
  }
  // Päiväputki
  const days = new Set(state.attempts.map(a => dayKey(a.t)));
  let streak = 0; let d = Date.now();
  if (!days.has(dayKey(d))) d -= DAY;
  while (days.has(dayKey(d))) { streak++; d -= DAY; }

  const lastTest = state.tests.reduce((m, t) => t.t > (m?.t || 0) ? t : m, null);
  const attemptsSinceTest = state.attempts.filter(a => !lastTest || a.t > lastTest.t).length;
  const daysSinceTest = lastTest ? (now - lastTest.t) / DAY : Infinity;
  const testDue = !lastTest || daysSinceTest >= TEST_INTERVAL_DAYS || attemptsSinceTest >= 90;
  const testOverdueDays = lastTest ? Math.max(0, daysSinceTest - TEST_INTERVAL_DAYS) : 0;

  const overall = Math.round(0.15 * sk.grammar.r + 0.2 * sk.sentence.r + 0.25 * sk.writing.r + 0.25 * sk.speaking.r + 0.15 * sk.fluency.r);
  const todayAttempts = state.attempts.filter(a => dayKey(a.t) === dayKey());
  const todayMinutes = Math.round(todayAttempts.reduce((m, a) => m + (a.ms || 0), 0) / 60000);

  const weakTags = Object.entries(tags).filter(([, v]) => v.n >= 2).map(([k, v]) => ({ tag: k, acc: v.acc, n: v.n }))
    .sort((a, b) => a.acc - b.acc);

  return { sk, tags, weakTags, srs, personal, streak, lastTest, testDue, testOverdueDays, attemptsSinceTest, overall, overallCefr: cefr(overall), todayAttempts, todayMinutes, placementDone: !!lastTest };
}

function slopePerWeek(pts) {
  if (pts.length < 3 || pts.at(-1).t - pts[0].t < 3 * DAY) return 0;
  const xs = pts.map(p => p.t / (7 * DAY)), ys = pts.map(p => p.r);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? clamp(Math.round(num / den), -150, 150) : 0;
}

// Arvio, milloin tavoite saavutetaan nykyisellä suunnalla
export function eta(S, goal) {
  const target = GOAL_RATING[goal] || 1300;
  if (S.r >= target) return { reached: true };
  if (S.trend <= 2) return { reached: false, weeks: null };
  return { reached: false, weeks: Math.ceil((target - S.r) / S.trend) };
}

// ---- Tehtäväpooli ----
export function pool(state, D) {
  return [...BANK, ...(state.gen || []), ...Object.values(D.personal)];
}
export function findItem(state, D, id) { return pool(state, D).find(i => i.id === id); }

// Tarve per taito: kaukana tavoitteesta + laskeva suunta + tuottavat taidot painottuvat
function needs(D, goal) {
  const target = GOAL_RATING[goal] || 1300;
  const w = {};
  for (const s in D.sk) {
    const S = D.sk[s];
    let x = clamp((target - S.r) / 200 + 0.4, 0.25, 2.5);
    if (S.trend < -5) x *= 1.35;
    if (s === 'writing' || s === 'speaking') x *= 1.3;
    w[s] = x;
  }
  return w;
}

function tagWeakness(D, item) {
  let w = 0;
  for (const t of item.tags || []) { const T = D.tags[t]; if (T && T.n >= 2) w += Math.max(0, 0.85 - T.acc); }
  return w;
}

// Valitse paras tehtävä annetuista tyypeistä taidon tason ja heikkouksien mukaan
export function pick(state, D, types, skill, exclude = new Set(), opts = {}) {
  const S = D.sk[skill];
  const recent = new Map();
  for (const a of state.attempts) if (a.itemId) recent.set(a.itemId, Math.max(recent.get(a.itemId) || 0, a.t));
  const now = Date.now();
  const cands = pool(state, D).filter(i => types.includes(i.type) && !exclude.has(i.id) && !(i.personal && !opts.allowPersonal));
  let best = null, bestScore = -Infinity;
  for (const it of cands) {
    const target = S.r + (opts.offset ?? 40); // haastava mutta saavutettava (~65–75 % onnistuminen)
    let sc = -Math.abs(it.d - target) / 110;
    sc += 0.9 * tagWeakness(D, it);
    const last = recent.get(it.id);
    if (last) { const days = (now - last) / DAY; sc -= days < 3 ? 3 : days < 10 ? 1.2 : 0.3; }
    if (it.gen) sc += 0.25; // tuoreet tekoälytehtävät
    sc += Math.random() * 0.35;
    if (sc > bestScore) { bestScore = sc; best = it; }
  }
  return best;
}

// ---- Päivän suunnitelma ----
export function buildPlan(state, D) {
  const minutes = state.profile.minutes || 15;
  const flexSlots = minutes <= 10 ? 2 : minutes <= 15 ? 4 : 7;
  const used = new Set();
  const ids = [];
  const add = it => { if (it && !used.has(it.id)) { used.add(it.id); ids.push(it.id); } };

  // 1) Erääntyneet kertaukset (omat virheet ensin)
  const due = Object.entries(D.srs).filter(([, v]) => v.due <= Date.now()).sort((a, b) => a[1].due - b[1].due);
  const dueMax = minutes <= 10 ? 2 : 3;
  for (const [id] of due.sort((a, b) => (b[0].startsWith('pe:') ? 1 : 0) - (a[0].startsWith('pe:') ? 1 : 0)).slice(0, dueMax)) {
    if (findItem(state, D, id)) add({ id });
  }
  // 2) Lämmittely: kielioppi
  add(pick(state, D, ['mcq'], 'grammar', used));
  // 3) Joustavat paikat tarpeen mukaan
  const w = needs(D, state.profile.goal);
  const typeFor = { grammar: ['mcq'], sentence: ['order', 'fix', 'tr'], fluency: ['tr', 'order'], writing: ['tr', 'fix'], speaking: ['tr', 'order'] };
  const skillFor = { grammar: 'grammar', sentence: 'sentence', fluency: 'sentence', writing: 'sentence', speaking: 'sentence' };
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (let i = 0; i < flexSlots; i++) {
    let r = Math.random() * total, s = 'sentence';
    for (const k in w) { r -= w[k]; if (r <= 0) { s = k; break; } }
    add(pick(state, D, typeFor[s], skillFor[s], used));
  }
  // 4) Pakolliset: yksi kirjoitus ja yksi puhe joka päivä
  add(pick(state, D, ['write'], 'writing', used));
  if (minutes >= 25) add(pick(state, D, ['write'], 'writing', used));
  add(pick(state, D, ['speak'], 'speaking', used));
  return { date: dayKey(), ids, done: [] };
}

export function focusText(D) {
  const t = D.weakTags.slice(0, 2).map(x => TAGS[x.tag]);
  if (!t.length) return 'Järjestelmä oppii heikkoutesi ensimmäisistä harjoituksista';
  return 'Painotus: ' + t.join(', ').toLowerCase();
}

// ---- Arvosanat → luokitusmuutokset ----
// Palauttaa listan {s, d, score} päivityksistä yhdelle suoritukselle
export function updatesFor(item, score, ms, extra = {}) {
  const u = [{ s: item.skill, d: item.d, score }];
  if (item.type === 'tr' || item.type === 'order') {
    const target = item.type === 'tr' ? 30000 + (item.fi?.length || 40) * 250 : 25000;
    const f = score < 0.6 ? 0.2 : clamp(1 - (ms - target) / (2 * target), 0, 1);
    u.push({ s: 'fluency', d: item.d, score: f });
  }
  if (item.type === 'write' && extra.wpmWriting != null) {
    u.push({ s: 'fluency', d: item.d, score: clamp((extra.wpmWriting - 6) / 14, 0, 1) });
  }
  if (item.type === 'speak' && extra.wpm != null) {
    u.push({ s: 'fluency', d: item.d, score: clamp((extra.wpm - 60) / 70, 0, 1) });
  }
  if ((item.type === 'write' || item.type === 'speak') && extra.grammarScore != null) {
    u.push({ s: 'grammar', d: item.d, score: extra.grammarScore });
  }
  return u;
}

// ---- Adaptiivinen tasotesti ----
export function createTest(state, D, placement, priorAdj = {}) {
  const th = {};
  for (const s in PRIOR) th[s] = (placement ? PRIOR[s] + (priorAdj[s] || 0) : D.sk[s].r);
  const plan = ['grammar', 'sentence', 'grammar', 'sentence', 'grammar', 'sentence', 'grammar', 'sentence', 'grammar', 'sentence', 'grammar', 'sentence', 'write', 'speak'];
  return { placement, th, start: { ...th }, n: { grammar: 0, sentence: 0 }, plan, i: 0, used: [], log: [], t0: Date.now() };
}

export function nextTestItem(state, D, T) {
  const step = T.plan[T.i];
  if (!step) return null;
  const fakeD = { ...D, sk: Object.fromEntries(Object.entries(T.th).map(([k, r]) => [k, { r }])) };
  const used = new Set(T.used);
  // Testissä ei kertauksia eikä viimeaikaisia tehtäviä; tavoite = arvioitu taso
  if (step === 'grammar') return pick(state, fakeD, ['mcq'], 'grammar', used, { offset: 0 });
  if (step === 'sentence') return pick(state, fakeD, ['order', 'fix', 'tr'], 'sentence', used, { offset: 0 });
  if (step === 'write') return pick(state, fakeD, ['write'], 'writing', used, { offset: 0 });
  if (step === 'speak') return pick(state, fakeD, ['speak'], 'speaking', used, { offset: 0 });
}

export function testRecord(T, item, score, ms, extra = {}) {
  T.used.push(item.id);
  T.log.push({ id: item.id, type: item.type, d: item.d, score, ms });
  const upd = (s, d, sc) => { const n = T.n[s] || 0; T.th[s] = Math.round(T.th[s] + kFor(n, true) * (sc - expected(T.th[s], d))); T.n[s] = n + 1; };
  if (item.type === 'write' || item.type === 'speak') {
    // Avoimissa tehtävissä arvio tulee suoraan CEFR-tasosta (tekoäly tai itsearvio)
    if (extra.cefrRating) T.th[item.skill] = Math.round(0.25 * T.th[item.skill] + 0.75 * extra.cefrRating);
    else upd(item.skill, item.d, score);
    if (extra.wpm != null) T.flu = [...(T.flu || []), clamp((extra.wpm - 60) / 70, 0, 1)];
    if (extra.wpmWriting != null) T.flu = [...(T.flu || []), clamp((extra.wpmWriting - 6) / 14, 0, 1)];
  } else {
    upd(item.skill, item.d, score);
    if (item.type !== 'mcq') {
      const target = item.type === 'tr' ? 30000 + (item.fi?.length || 40) * 250 : 25000;
      T.flu = [...(T.flu || []), score < 0.6 ? 0.2 : clamp(1 - (ms - target) / (2 * target), 0, 1)];
    }
  }
  T.i++;
}

export function finishTest(T) {
  const est = { ...T.th };
  if (T.flu?.length) {
    const f = T.flu.reduce((a, b) => a + b, 0) / T.flu.length; // 0..1
    est.fluency = Math.round(950 + f * 550);
  }
  return { id: uid(), t: Date.now(), placement: T.placement, est, log: T.log };
}

export const CEFR_MID = { A2: 900, B1: 1100, B2: 1300, C1: 1500, C2: 1700 };
