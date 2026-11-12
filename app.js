import { TAGS, SELF_ASSESS } from './data.js';
import * as E from './engine.js';
import * as AI from './ai.js';
import * as SY from './sync.js';

// ---------- Tila ----------
const LS_STATE = 'ec-state', LS_SET = 'ec-settings';
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
let state = load(LS_STATE) || E.emptyState();
let settings = { ...AI.AI_DEFAULTS, syncMode: 'none', srLang: 'en-US', ...(load(LS_SET) || {}) };
let D = E.derive(state);
let session = null;
let cleanups = [];
let syncInfo = { busy: false, err: '', at: settings.lastSync || 0 };

function save() {
  state.updatedAt = Date.now();
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); }
  catch {
    // Tila täynnä: poista yli 90 pv vanhojen tekstien raakateksti (arviot ja virheet säilyvät)
    const cut = Date.now() - 90 * 864e5;
    state.attempts.forEach(a => { if (a.t < cut) delete a.text; });
    state.gen = state.gen.slice(-200);
    localStorage.setItem(LS_STATE, JSON.stringify(state));
  }
}
function saveSettings(patch) { settings = { ...settings, ...patch }; localStorage.setItem(LS_SET, JSON.stringify(settings)); }
function refresh() { D = E.derive(state); }
function aiCtx() {
  return { workDesc: state.profile.workDesc, level: `${D.overallCefr.label} (writing ${D.sk.writing.cefr.label})`, goal: state.profile.goal, weak: D.weakTags.slice(0, 4).map(t => t.tag).join(', ') };
}

// ---------- Apurit ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = () => $('#main');
const words = s => (s.trim().match(/[A-Za-z0-9'’-]+/g) || []).length;
const fmtDate = t => new Date(t).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' });
const TYPE = { mcq: 'Monivalinta', order: 'Sanajärjestys', fix: 'Korjaa virhe', tr: 'Käännä', write: 'Kirjoita' };
function itemTitle(it) {
  if (it.type === 'write') return `${it.title} (${it.ctx})`;
  if (it.personal) return 'Oma aiempi virhe';
  return TAGS[it.tags?.[0]] || TYPE[it.type];
}
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 4200);
}
function every(ms, fn) { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); }
function onLeave(fn) { cleanups.push(fn); }
const arrow = v => v > 3 ? `<span class="up">▲ +${v}</span>` : v < -3 ? `<span class="down">▼ ${v}</span>` : `<span class="flat">● ${v >= 0 ? '+' : ''}${v}</span>`;

// ---------- Kuuntelu (ääneen luku) ----------
const hasTTS = 'speechSynthesis' in window;
function voice() {
  const vs = speechSynthesis.getVoices().filter(v => v.lang?.startsWith('en'));
  return vs.find(v => v.lang === settings.srLang && /natural|google|samantha|daniel|serena/i.test(v.name)) || vs.find(v => v.lang === settings.srLang) || vs[0];
}
function say(text, rate = 0.95) {
  if (!hasTTS) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\[.*?\]|…/g, ' '));
  u.lang = settings.srLang; const v = voice(); if (v) u.voice = v; u.rate = rate;
  speechSynthesis.speak(u);
}
if (hasTTS) speechSynthesis.onvoiceschanged = () => { };

// ---------- Reititys ----------
const routes = { today: viewToday, practice: viewPractice, progress: viewProgress, settings: viewSettings, test: viewTest, run: viewRun, review: viewReview };
function render() {
  cleanups.forEach(f => f()); cleanups = [];
  if (hasTTS) speechSynthesis.cancel();
  const [r, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const route = routes[r] ? r : 'today';
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === route || (route === 'run' && a.dataset.r === 'today')));
  renderHeader();
  routes[route](arg);
  main().focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function go(h) { if (location.hash === h) render(); else location.hash = h; }
window.addEventListener('hashchange', render);

function renderHeader() {
  $('#hdr-level').textContent = D.placementDone ? D.overallCefr.label : '–';
  $('#hdr-level').title = D.placementDone ? `Kokonaistaso ${D.overall}` : 'Lähtötaso mittaamatta';
  $('#hdr-streak').textContent = D.streak ? `${D.streak} pv putki` : 'Ei putkea';
}

// ---------- Tänään ----------
function ensurePlan() {
  if (!state.plan || state.plan.date !== E.dayKey() || !state.plan.ids?.length || state.plan.ids.some(id => !E.findItem(state, D, id))) { state.plan = E.buildPlan(state, D); save(); }
}
function viewToday() {
  if (!D.placementDone) {
    main().innerHTML = `
      <section class="page">
        <h1>Aloitetaan lähtötasosta</h1>
        <p class="lead">Punakynä mittaa ensin, missä olet: viisi kysymystä itsestäsi ja noin 12 minuutin adaptiivinen testi. Testi vaikeutuu kun vastaat oikein ja helpottuu kun vastaat väärin, joten se löytää tasosi nopeasti.</p>
        <ol class="steps">
          <li>Itsearvio: 5 monivalintaa</li>
          <li>12 lyhyttä tehtävää: kielioppi, lauseenmuodostus, käännökset</li>
          <li>Yksi työsähköposti</li>
        </ol>
        ${AI.aiReady(settings) ? '' : `<p class="note">Kirjoitus arvioidaan tarkimmin tekoälyllä. Lisää ilmainen Gemini-avain <a href="#/settings">asetuksissa</a> ennen testiä – ilman sitä arvioit tekstisi itse mallivastausta vasten.</p>`}
        <div class="actions"><button class="btn primary" id="go-test">Aloita lähtötasotesti</button></div>
      </section>`;
    $('#go-test').onclick = () => go('#/test');
    return;
  }
  if (D.testDue && D.testOverdueDays > 3) {
    main().innerHTML = `<section class="page"><h1>Tasotesti on myöhässä</h1>
      <p class="lead">Edellisestä testistä on ${Math.round(14 + D.testOverdueDays)} päivää. Harjoittelu avautuu, kun teet testin. Näin taso pysyy mitattuna, eikä vain arvioituna.</p>
      <div class="actions"><button class="btn primary" id="go-test">Tee tasotesti</button></div></section>`;
    $('#go-test').onclick = () => go('#/test');
    return;
  }
  ensurePlan();
  const items = state.plan.ids.map(id => E.findItem(state, D, id)).filter(Boolean);
  const done = new Set(state.plan.done);
  const left = items.filter(i => !done.has(i.id));
  const dueCount = Object.values(D.srs).filter(v => v.due <= Date.now()).length;
  main().innerHTML = `
    <section class="page">
      <h1>${left.length ? 'Päivän tehtävät' : 'Päivän tehtävät tehty'}</h1>
      <p class="lead">${esc(E.focusText(D))}.</p>
      ${D.testDue ? `<div class="banner"><div><strong>Tasotesti on ajankohtainen.</strong> Se kestää noin 15 minuuttia ja päivittää tasosi.</div><button class="btn" id="go-test">Tee testi</button></div>` : ''}
      <ul class="plan">
        ${items.map(it => `<li class="${done.has(it.id) ? 'done' : ''}">
          <span class="check" aria-hidden="true"></span>
          <span class="pt">${TYPE[it.type]}</span>
          <span class="pn">${esc(itemTitle(it))}</span>
          ${it.type === 'write' ? '<span class="must">pakollinen</span>' : ''}
        </li>`).join('')}
      </ul>
      <div class="actions">
        ${left.length ? `<button class="btn primary" id="start">${done.size ? 'Jatka' : 'Aloita'} (${left.length})</button>` : `<button class="btn" id="extra">Lisäkierros</button>`}
      </div>
      <div class="facts">
        <div><span class="k">Tänään</span><span class="v">${D.todayMinutes} min</span></div>
        <div><span class="k">Kertausjono</span><span class="v">${dueCount}</span></div>
        <div><span class="k">Seuraava testi</span><span class="v">${D.testDue ? 'nyt' : nextTestDate()}</span></div>
      </div>
    </section>`;
  $('#start')?.addEventListener('click', () => startSession(left.map(i => i.id), 'plan'));
  $('#extra')?.addEventListener('click', () => { state.plan = E.buildPlan(state, D); save(); render(); });
  $('#go-test')?.addEventListener('click', () => go('#/test'));
}
function nextTestDate() {
  if (!D.lastTest) return 'nyt';
  return fmtDate(D.lastTest.t + E.TEST_INTERVAL_DAYS * 864e5);
}

// ---------- Harjoittele ----------
function viewPractice() {
  const due = Object.entries(D.srs).filter(([, v]) => v.due <= Date.now()).map(([k]) => k).filter(id => E.findItem(state, D, id));
  const attempted = new Set(state.attempts.map(a => a.itemId));
  const freshGen = state.gen.filter(g => !attempted.has(g.id));
  const opts = [
    ['review', 'Kertaa virheet', `${due.length} erääntynyttä, omat virheesi ensin`, !due.length],
    ['mcq', 'Kielioppi', 'Monivalinnat tasosi mukaan'],
    ['order', 'Sanajärjestys', 'Rakenna lause palasista'],
    ['fix', 'Korjaa virhe', 'Suomalaisten tyypilliset virheet'],
    ['tr', 'Käännä', 'Suomesta englanniksi, ajastettu'],
    ['write', 'Kirjoita', 'Sähköposti, Teams-viesti tai dokumentti'],
    ['gen', 'Tekoälyn uudet tehtävät', AI.aiReady(settings) ? `${freshGen.length} valmiina heikkouksiesi pohjalta` : 'Vaatii tekoälyavaimen', !freshGen.length && !AI.aiReady(settings)],
  ];
  if (!D.placementDone || (D.testDue && D.testOverdueDays > 3)) { viewToday(); return; }
  main().innerHTML = `<section class="page"><h1>Harjoittele</h1>
    <p class="lead">Vapaa harjoittelu. Tehtävät valitaan tasosi ja heikkouksiesi mukaan, ja jokainen vastaus päivittää tasoarviota.</p>
    <div class="grid">${opts.map(([k, t, d, dis]) => `<button class="tile" data-k="${k}" ${dis ? 'disabled' : ''}><span class="tt">${t}</span><span class="td">${esc(d)}</span></button>`).join('')}</div></section>`;
  $$('.tile').forEach(b => b.onclick = async () => {
    const k = b.dataset.k;
    if (k === 'review') return startSession(due.slice(0, 8), 'free');
    if (k === 'gen') {
      if (freshGen.length < 3 && AI.aiReady(settings)) { b.disabled = true; b.querySelector('.td').textContent = 'Luodaan tehtäviä…'; await maybeGenerate(true); }
      const ids = state.gen.filter(g => !new Set(state.attempts.map(a => a.itemId)).has(g.id)).slice(0, 6).map(g => g.id);
      if (!ids.length) return toast('Tehtävien luonti epäonnistui. Tarkista tekoälyasetukset.', true);
      return startSession(ids, 'free');
    }
    const n = k === 'write' ? 1 : 6;
    const skill = { mcq: 'grammar', write: 'writing' }[k] || 'sentence';
    const used = new Set(), ids = [];
    for (let i = 0; i < n; i++) { const it = E.pick(state, D, [k], skill, used); if (it) { used.add(it.id); ids.push(it.id); } }
    startSession(ids, 'free');
  });
}

// ---------- Harjoituskierros ----------
function snapshot() { return Object.fromEntries(Object.entries(D.sk).map(([k, v]) => [k, v.r])); }
function startSession(ids, mode) {
  if (!ids.length) return toast('Ei tehtäviä juuri nyt.');
  session = { ids, i: 0, mode, before: snapshot(), results: [] };
  go('#/run');
}

function recordAttempt(item, res) {
  const a = {
    id: E.uid(), t: Date.now(), itemId: item.id, type: item.type, skill: item.skill,
    tags: res.tags?.length ? res.tags : (item.tags || []), score: Math.round(res.score * 100) / 100, ms: res.ms,
    u: E.updatesFor(item, res.score, res.ms, res.extra || {}),
  };
  if (res.text) a.text = res.text.slice(0, 3000);
  if (res.fb) a.fb = res.fb;
  if (item.type === 'write') a.title = item.title;
  state.attempts.push(a);
  if (session?.mode === 'plan' && state.plan && !state.plan.done.includes(item.id)) state.plan.done.push(item.id);
  save(); refresh();
  return a;
}

function viewRun() {
  if (!session) return go('#/today');
  const total = session.test ? session.test.plan.length : session.ids.length;
  if (session.i >= total) return session.test ? finishTestView() : summaryView();
  const item = session.test ? E.nextTestItem(state, D, session.test) : E.findItem(state, D, session.ids[session.i]);
  if (!item) {
    if (session.test) { session.test.i++; session.i = session.test.i; } else session.i++;
    return viewRun();
  }
  const cx = {
    test: !!session.test,
    submit(res) {
      session.results.push({ item, res });
      if (session.test) E.testRecord(session.test, item, res.score, res.ms, res.extra || {});
      else recordAttempt(item, res);
    },
    next() { if (!session.test) session.i++; else session.i = session.test.i; render(); },
  };
  const label = `${session.test ? 'Tasotesti' : TYPE[item.type]}`;
  main().innerHTML = `
    <section class="ex">
      <div class="ex-top">
        <button class="link" id="quit">Lopeta</button>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${session.i}"><i style="width:${(session.i / total) * 100}%"></i></div>
        <span class="count">${session.i + 1} / ${total}</span>
      </div>
      <p class="kicker">${label}${session.test ? '' : ` · ${esc(itemTitle(item))}`}${item.gen ? ' · tekoälyn tehtävä' : ''}</p>
      <div id="ex-body"></div>
    </section>`;
  $('#quit').onclick = () => {
    if (session.test && !confirm('Keskeytetäänkö testi? Tuloksia ei tallenneta.')) return;
    const wasTest = !!session.test; const hadResults = session.results.length;
    if (!wasTest && hadResults) { session.i = total; return render(); }
    session = null; go('#/today');
  };
  RENDER[item.type](item, cx, $('#ex-body'));
}

const nextBtn = (cx, el, label = 'Seuraava') => {
  const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = label; b.onclick = () => cx.next();
  el.append(b); b.focus();
};
function verdict(el, score, html) {
  const cls = score >= 0.85 ? 'ok' : score >= 0.45 ? 'mid' : 'bad';
  const head = score >= 0.85 ? 'Oikein' : score >= 0.45 ? 'Melkein' : 'Väärin';
  el.innerHTML = `<div class="verdict ${cls}"><strong>${head}.</strong> ${html || ''}</div>`;
}

const RENDER = {
  mcq(item, cx, root) {
    const t0 = Date.now();
    const q = esc(item.q).replace('___', '<span class="gap">&nbsp;</span>');
    root.innerHTML = `<p class="prompt en">${q}</p><div class="opts">${item.opts.map((o, i) => `<button class="opt en" data-i="${i}">${esc(o)}</button>`).join('')}</div><div class="fb"></div><div class="actions"></div>`;
    $$('.opt', root).forEach(b => b.onclick = () => {
      const i = +b.dataset.i, ok = i === item.a;
      $$('.opt', root).forEach(x => x.disabled = true);
      cx.submit({ score: ok ? 1 : 0, ms: Date.now() - t0 });
      if (cx.test) return cx.next();
      b.classList.add(ok ? 'right' : 'wrong'); $$('.opt', root)[item.a].classList.add('right');
      $('.gap', root).textContent = item.opts[item.a];
      verdict($('.fb', root), ok ? 1 : 0, esc(item.ex));
      nextBtn(cx, $('.actions', root));
    });
  },

  order(item, cx, root) {
    const t0 = Date.now();
    const w = item.text.split(' ');
    let idx = w.map((_, i) => i);
    do { idx.sort(() => Math.random() - 0.5); } while (w.length > 2 && idx.every((v, i) => v === i));
    const placed = [];
    root.innerHTML = `<p class="prompt fi">${esc(item.fi)}</p>
      <div class="line en" aria-label="Rakentamasi lause"></div>
      <div class="chips en"></div><div class="fb"></div>
      <div class="actions"><button class="btn primary" id="chk" disabled>Tarkista</button><button class="btn" id="clr">Tyhjennä</button></div>`;
    const draw = () => {
      $('.line', root).innerHTML = placed.map((i, p) => `<button class="chip in" data-p="${p}">${esc(w[i])}</button>`).join('') || '<span class="ph">Napauta sanoja oikeassa järjestyksessä</span>';
      $('.chips', root).innerHTML = idx.map(i => placed.includes(i) ? `<span class="chip ghost">${esc(w[i])}</span>` : `<button class="chip" data-i="${i}">${esc(w[i])}</button>`).join('');
      $$('.chips .chip[data-i]', root).forEach(b => b.onclick = () => { placed.push(+b.dataset.i); draw(); });
      $$('.line .chip', root).forEach(b => b.onclick = () => { placed.splice(+b.dataset.p, 1); draw(); });
      $('#chk').disabled = placed.length !== w.length;
    };
    draw();
    $('#clr').onclick = () => { placed.length = 0; draw(); };
    $('#chk').onclick = () => {
      const ans = placed.map(i => w[i]).join(' ');
      const ok = item.ans.some(a => E.norm(a) === E.norm(ans));
      cx.submit({ score: ok ? 1 : 0, ms: Date.now() - t0 });
      if (cx.test) return cx.next();
      $$('button.chip', root).forEach(b => b.disabled = true);
      $('#chk').remove(); $('#clr').remove();
      verdict($('.fb', root), ok ? 1 : 0, ok ? '' : `Oikea järjestys: <span class="en">${esc(item.text)}</span>`);
      const l = document.createElement('button'); l.className = 'btn'; l.textContent = 'Kuuntele'; l.onclick = () => say(item.text);
      if (hasTTS) $('.actions', root).append(l);
      nextBtn(cx, $('.actions', root));
    };
  },

  fix(item, cx, root) { openAnswer(item, cx, root); },
  tr(item, cx, root) { openAnswer(item, cx, root); },
  write: renderWrite,
};

// Avoin lyhyt vastaus (korjaa / käännä)
function openAnswer(item, cx, root) {
  const t0 = Date.now();
  const isTr = item.type === 'tr';
  root.innerHTML = `
    ${isTr ? `<p class="prompt fi">${esc(item.fi)}</p>` : `<p class="hint">Korjaa lause. ${item.personal ? 'Tämä on sinun oma aiempi virheesi.' : ''}</p><p class="prompt en wrongline">${esc(item.wrong)}</p>`}
    <div class="field"><textarea id="ans" class="en" rows="3" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="${isTr ? 'Kirjoita englanniksi…' : ''}">${isTr ? '' : esc(item.wrong)}</textarea></div>
    ${isTr ? '<p class="timer" id="tm"></p>' : ''}
    <div class="fb"></div><div class="actions"><button class="btn primary" id="chk">Tarkista</button></div>`;
  const ta = $('#ans'); ta.focus();
  if (!isTr) ta.setSelectionRange(ta.value.length, ta.value.length);
  if (isTr) every(500, () => { const s = Math.round((Date.now() - t0) / 1000); $('#tm').textContent = `${s} s`; $('#tm').classList.toggle('slow', s > 45); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chk').click(); } });
  $('#chk').onclick = async () => {
    const answer = ta.value.trim();
    if (!answer) return ta.focus();
    const ms = Date.now() - t0;
    $('#chk').disabled = true; ta.readOnly = true;
    const best = E.bestMatch(answer, item.ans);
    const unchanged = !isTr && E.norm(answer) === E.norm(item.wrong);
    const finish = (score, html, extraTags) => {
      cx.submit({ score, ms, tags: extraTags });
      if (cx.test) return cx.next();
      verdict($('.fb', root), score, html);
      $('#chk').remove();
      if (hasTTS) { const l = document.createElement('button'); l.className = 'btn'; l.textContent = 'Kuuntele oikea'; l.onclick = () => say(best.ans); $('.actions', root).append(l); }
      nextBtn(cx, $('.actions', root));
    };
    if (best.sim === 1) return finish(1, item.ex ? esc(item.ex) : '');
    if (unchanged) return finish(0, `Lause oli virheellinen. Oikein: <span class="en">${esc(item.ans[0])}</span>. ${esc(item.ex || '')}`);
    if (AI.aiReady(settings)) {
      $('.fb', root).innerHTML = '<p class="busy">Tarkistetaan…</p>';
      try {
        const r = await AI.checkShort(settings, aiCtx(), item, answer);
        const sc = Number(r.score) || 0;
        const tags = r.tag && TAGS[r.tag] ? [...new Set([...(item.tags || []), r.tag])] : undefined;
        return finish(sc, `${sc < 1 ? `Parempi: <span class="en">${esc(r.correct || best.ans)}</span>. ` : ''}${esc(r.why || item.ex || '')}`, tags);
      } catch (e) { toast(e.message, true); }
    }
    // Ilman tekoälyä: näytä malli ja pyydä itsearvio
    $('.fb', root).innerHTML = `<div class="verdict mid"><strong>Vertaa mallivastaukseen.</strong> <span class="en">${esc(best.ans)}</span>${item.ans.length > 1 ? `<details><summary>Muut hyväksytyt</summary><ul class="en">${item.ans.filter(a => a !== best.ans).map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}${item.ex ? `<p>${esc(item.ex)}</p>` : ''}</div>
      <p class="hint">Oliko vastauksesi yhtä oikein?</p>
      <div class="opts row"><button class="opt" data-s="1">Kyllä, merkitys ja rakenne oikein</button><button class="opt" data-s="0.5">Osittain, pieni virhe</button><button class="opt" data-s="0">Ei</button></div>`;
    $$('.fb .opt', root).forEach(b => b.onclick = () => {
      const s = Math.min(0.85, +b.dataset.s); // itsearvio ei koskaan anna täysiä pisteitä
      cx.submit({ score: s, ms });
      if (cx.test) return cx.next();
      $$('.fb .opt', root).forEach(x => x.disabled = true); b.classList.add('right');
      $('#chk').remove(); nextBtn(cx, $('.actions', root));
    });
  };
}

// Itsearvio CEFR-kuvauksilla (kun tekoälyä ei ole)
const SELF_LEVELS = [
  ['Viesti menee perille, mutta rakenteissa on paljon virheitä ja jouduin hakemaan sanoja', 0.45, 1050],
  ['Selkeä ja ymmärrettävä, joitain virheitä (esim. artikkelit, prepositiot, aikamuodot)', 0.65, 1180],
  ['Lähes mallivastauksen tasoa, vain pieniä lipsahduksia', 0.8, 1320],
  ['Yhtä luonteva kuin mallivastaus', 0.9, 1470],
];

function renderWrite(item, cx, root) {
  const t0 = Date.now();
  const draftKey = 'ec-draft-' + item.id;
  root.innerHTML = `
    <p class="task">${esc(item.task)}</p>
    <p class="hint">Vähintään ${item.minWords} sanaa. Älä käytä kääntäjää: tarkoitus on tuottaa itse, virheet ovat tässä hyödyllisiä.</p>
    <textarea id="txt" class="en big" rows="9" spellcheck="false" autocapitalize="sentences" placeholder="Kirjoita englanniksi…">${esc(localStorage.getItem(draftKey) || '')}</textarea>
    <div class="meta"><span id="wc">0 sanaa</span><span id="tm">0:00</span></div>
    <div class="fb"></div><div class="actions"><button class="btn primary" id="send" disabled>Lähetä arvioitavaksi</button></div>`;
  const ta = $('#txt'); ta.focus();
  const upd = () => { const n = words(ta.value); $('#wc').textContent = `${n} / ${item.minWords} sanaa`; $('#send').disabled = n < item.minWords; localStorage.setItem(draftKey, ta.value); };
  ta.oninput = upd; upd();
  every(1000, () => { const s = Math.round((Date.now() - t0) / 1000); $('#tm').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; });
  $('#send').onclick = async () => {
    const text = ta.value.trim(), ms = Date.now() - t0;
    const wpmWriting = words(text) / Math.max(ms / 60000, 0.5);
    ta.readOnly = true; $('#send').disabled = true;
    localStorage.removeItem(draftKey);
    await openFeedback(item, cx, root, text, ms, { wpmWriting }, () => AI.evalWriting(settings, aiCtx(), item, text));
  };
}

// Kirjoitus: tekoälyarvio punakynällä, tai mallivastaus + itsearvio
async function openFeedback(item, cx, root, text, ms, extra, evalFn) {
  const fbEl = $('.fb', root), act = $('.actions', root);
  if (AI.aiReady(settings)) {
    fbEl.innerHTML = '<p class="busy">Arvioidaan…</p>';
    try {
      const fb = await evalFn();
      const score = Math.max(0, Math.min(100, Number(fb.score) || 0)) / 100;
      const grammarScore = fb.sub?.grammar != null ? fb.sub.grammar / 100 : null;
      const cefrRating = E.CEFR_MID[fb.cefr] || null;
      const clean = { score: fb.score, cefr: fb.cefr, sub: fb.sub, errors: (fb.errors || []).slice(0, 8), improved: fb.improved, tip: fb.tip };
      cx.submit({ score, ms, text, fb: clean, extra: { ...extra, grammarScore, cefrRating } });
      fbEl.innerHTML = feedbackHTML(text, clean, item);
      bindFeedback(fbEl, clean, item);
      nextBtn(cx, act, cx.test ? 'Jatka' : 'Seuraava');
      return;
    } catch (e) { toast(e.message, true); }
  }
  fbEl.innerHTML = `
    <div class="model"><h3>Mallivastaus</h3><p class="en pre">${esc(item.model)}</p>${hasTTS ? '<button class="btn" id="lm">Kuuntele</button>' : ''}</div>
    <p class="hint">Vertaa omaasi malliin. Mikä kuvaus vastaa vastaustasi parhaiten?</p>
    <div class="opts">${SELF_LEVELS.map(([t], i) => `<button class="opt" data-i="${i}">${esc(t)}</button>`).join('')}</div>`;
  $('#lm')?.addEventListener('click', () => say(item.model, 0.9));
  $$('.opt', fbEl).forEach(b => b.onclick = () => {
    const [, s, r] = SELF_LEVELS[+b.dataset.i];
    $$('.opt', fbEl).forEach(x => x.disabled = true); b.classList.add('right');
    cx.submit({ score: s, ms, text, extra: { ...extra, cefrRating: r } });
    nextBtn(cx, act, cx.test ? 'Jatka' : 'Seuraava');
  });
}

function redPen(text, errors) {
  const marks = [], spans = [];
  errors.forEach((e, n) => {
    if (!e.orig) return;
    let i = text.indexOf(e.orig);
    if (i < 0) i = text.toLowerCase().indexOf(e.orig.toLowerCase());
    if (i < 0 || spans.some(([a, b]) => i < b && i + e.orig.length > a)) return;
    spans.push([i, i + e.orig.length]); marks.push({ i, len: e.orig.length, n, e });
  });
  marks.sort((a, b) => a.i - b.i);
  let out = '', pos = 0;
  for (const m of marks) {
    out += esc(text.slice(pos, m.i));
    out += `<span class="pen"><del>${esc(text.substr(m.i, m.len))}</del><ins>${esc(m.e.fix)}</ins><sup>${m.n + 1}</sup></span>`;
    pos = m.i + m.len;
  }
  return (out + esc(text.slice(pos))).replace(/\n/g, '<br>');
}

function feedbackHTML(text, fb, item) {
  const sub = fb.sub || {};
  const subNames = { grammar: 'Kielioppi', vocabulary: 'Sanasto', clarity: 'Selkeys', tone: 'Sävy', task: 'Tehtävä' };
  return `
    <div class="score-row">
      <div class="score"><span class="num">${fb.score}</span><span class="of">/100</span></div>
      <div class="cefr-tag" title="Tämän tekstin taso">${esc(fb.cefr || '')}</div>
      <div class="subs">${Object.entries(subNames).filter(([k]) => sub[k] != null).map(([k, n]) => `<div class="sub"><span>${n}</span><i><b style="width:${sub[k]}%"></b></i><em>${sub[k]}</em></div>`).join('')}</div>
    </div>
    <div class="paper en">${redPen(text, fb.errors || [])}</div>
    ${fb.errors?.length ? `<ol class="errs">${fb.errors.map(e => `<li><span class="en"><del>${esc(e.orig)}</del> → <ins>${esc(e.fix)}</ins></span><span class="why">${esc(e.why || '')}${e.tag && TAGS[e.tag] ? ` <em>${TAGS[e.tag]}</em>` : ''}</span></li>`).join('')}</ol><p class="hint">Virheet lisätään kertausjonoosi omiksi tehtävikseen.</p>` : '<p class="hint">Ei kielivirheitä.</p>'}
    ${fb.tip ? `<p class="tip"><strong>Seuraavaksi:</strong> ${esc(fb.tip)}</p>` : ''}
    ${fb.improved ? `<div class="model"><h3>Luontevampi versio</h3><p class="en pre">${esc(fb.improved)}</p>${hasTTS ? '<button class="btn" id="li">Kuuntele</button>' : ''}</div>` : ''}
    ${item?.model ? `<details class="model"><summary>Mallivastaus</summary><p class="en pre">${esc(item.model)}</p></details>` : ''}`;
}
function bindFeedback(el, fb) { $('#li', el)?.addEventListener('click', () => say(fb.improved, 0.9)); }

// ---------- Yhteenveto ----------
function summaryView() {
  const before = session.before, res = session.results;
  const avg = res.length ? Math.round(res.reduce((a, r) => a + r.res.score, 0) / res.length * 100) : 0;
  const errs = res.reduce((n, r) => n + (r.res.fb?.errors?.length || 0), 0);
  main().innerHTML = `<section class="page"><h1>Kierros valmis</h1>
    <p class="lead">${res.length} tehtävää, keskimäärin ${avg} % oikein.${errs ? ` ${errs} omaa virhettä siirtyi kertausjonoon.` : ''}</p>
    <table class="deltas"><thead><tr><th>Taito</th><th>Taso</th><th>Muutos</th></tr></thead><tbody>
    ${Object.entries(E.SKILLS).map(([k, n]) => { const d = D.sk[k].r - before[k]; return `<tr><td>${n}</td><td>${D.sk[k].cefr.label} <span class="muted">${D.sk[k].r}</span></td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="actions"><button class="btn primary" id="home">Valmis</button></div></section>`;
  $('#home').onclick = () => { session = null; go('#/today'); };
  session.ended = true;
  autoSync(); maybeGenerate();
}

// ---------- Tasotesti ----------
function viewTest() {
  if (session?.test && session.i < session.test.plan.length) return go('#/run');
  const placement = !D.placementDone;
  if (placement) {
    const answers = {};
    main().innerHTML = `<section class="page"><h1>Itsearvio</h1><p class="lead">Vastaa rehellisesti. Tämä asettaa testin lähtökohdan, ei lopullista tasoa.</p>
      ${SELF_ASSESS.map((q, qi) => `<fieldset class="sa"><legend>${esc(q.q)}</legend>${q.opts.map(([t], oi) => `<button class="opt" data-q="${qi}" data-o="${oi}">${esc(t)}</button>`).join('')}</fieldset>`).join('')}
      <div class="field-row"><label for="wd">Mitä työssäsi teet englanniksi? (vapaaehtoinen, tekoäly räätälöi tehtävät)</label>
      <textarea id="wd" rows="3" placeholder="Esim. tuotekehitysinsinööri, palaverit saksalaisen toimittajan kanssa, teknisiä raportteja…">${esc(state.profile.workDesc)}</textarea></div>
      <div class="actions"><button class="btn primary" id="begin" disabled>Aloita testi</button></div></section>`;
    $$('.sa .opt').forEach(b => b.onclick = () => {
      $$(`.opt[data-q="${b.dataset.q}"]`).forEach(x => x.classList.remove('right'));
      b.classList.add('right'); answers[b.dataset.q] = +b.dataset.o;
      $('#begin').disabled = Object.keys(answers).length < SELF_ASSESS.length;
    });
    $('#begin').onclick = () => {
      const adj = {};
      SELF_ASSESS.forEach((q, i) => { adj[q.skill] = (adj[q.skill] || 0) + q.opts[answers[i]][1]; });
      state.profile = { ...state.profile, workDesc: $('#wd').value.trim(), updatedAt: Date.now(), selfAssess: answers };
      save();
      session = { test: E.createTest(state, D, true, adj), i: 0, results: [], before: snapshot() };
      go('#/run');
    };
    return;
  }
  main().innerHTML = `<section class="page"><h1>Tasotesti</h1>
    <p class="lead">13 tehtävää, noin 12 minuuttia. Testissä ei näytetä oikeita vastauksia kesken testin, ja kirjoitustehtävä arvioidaan lopuksi. Tulos painaa tasoarviossa enemmän kuin tavallinen harjoittelu.</p>
    <p>Edellinen testi: ${D.lastTest ? fmtDate(D.lastTest.t) : '–'}</p>
    <div class="actions"><button class="btn primary" id="begin">Aloita testi</button></div></section>`;
  $('#begin').onclick = () => { session = { test: E.createTest(state, D, false), i: 0, results: [], before: snapshot() }; go('#/run'); };
}

function finishTestView() {
  const T = session.test;
  const prev = D.lastTest;
  const rec = E.finishTest(T);
  state.tests.push(rec);
  if (state.plan) state.plan = null; // uusi suunnitelma päivittyneellä tasolla
  save(); refresh(); renderHeader();
  session = null;
  main().innerHTML = `<section class="page"><h1>Testin tulos: ${D.overallCefr.label}</h1>
    <p class="lead">Kokonaistaso ${D.overall}. ${analysisSentence()}</p>
    <table class="deltas"><thead><tr><th>Taito</th><th>Testissä</th><th>Taso nyt</th>${prev ? '<th>Ed. testi</th>' : ''}</tr></thead><tbody>
    ${Object.entries(E.SKILLS).map(([k, n]) => `<tr><td>${n}</td><td>${E.cefr(rec.est[k]).label} <span class="muted">${rec.est[k]}</span></td><td>${D.sk[k].cefr.label}</td>${prev ? `<td class="muted">${prev.est?.[k] ? E.cefr(prev.est[k]).label : '–'}</td>` : ''}</tr>`).join('')}
    </tbody></table>
    <p class="hint">Seuraava testi ${fmtDate(rec.t + E.TEST_INTERVAL_DAYS * 864e5)} Jos se myöhästyy yli 3 päivää, harjoittelu lukittuu testiin asti.</p>
    <div class="actions"><button class="btn primary" id="home">Päivän tehtäviin</button></div></section>`;
  $('#home').onclick = () => go('#/today');
  autoSync(); maybeGenerate();
}

// ---------- Edistyminen ----------
function analysisSentence() {
  const s = D.sk;
  const prod = s.writing.r;
  const recep = Math.round((s.grammar.r + s.sentence.r) / 2);
  const parts = [];
  const sorted = Object.entries(s).sort((a, b) => b[1].r - a[1].r);
  parts.push(`Vahvin: ${E.SKILLS[sorted[0][0]].toLowerCase()} (${sorted[0][1].cefr.label}), heikoin: ${E.SKILLS[sorted.at(-1)[0]].toLowerCase()} (${sorted.at(-1)[1].cefr.label}).`);
  if (recep - prod > 70) parts.push(`Kielitieto on ${recep - prod} pistettä tuottamista edellä: säännöt ovat tiedossa, mutta niiden käyttö omassa tekstissä on vielä hidasta. Painotus pysyy kirjoittamisessa.`);
  return parts.join(' ');
}

function trendSentence() {
  if (!state.attempts.length || Date.now() - state.attempts[0].t < 5 * 864e5) return 'Kehityksen suunta näkyy, kun harjoittelua on kertynyt noin viikon ajalta.';
  const ts = Object.values(D.sk).map(x => x.trend);
  const avg = Math.round(ts.reduce((a, b) => a + b, 0) / ts.length);
  const goal = state.profile.goal;
  const weakest = ['writing', D.sk.writing];
  const e = E.eta(weakest[1], goal);
  let txt = avg > 3 ? `Suunta on nouseva, keskimäärin +${avg} pistettä viikossa.` : avg < -3 ? `Suunta on laskeva (${avg} / vko). Järjestelmä painottaa heikentyneitä taitoja.` : 'Taso on pysynyt viimeiset neljä viikkoa ennallaan.';
  if (e.reached) txt += ` ${E.SKILLS[weakest[0]]} on jo tavoitetasolla ${goal}.`;
  else if (e.weeks) txt += ` Tällä tahdilla ${E.SKILLS[weakest[0]].toLowerCase()} on ${goal}-tasolla noin ${e.weeks} viikon päästä.`;
  else txt += ` ${E.SKILLS[weakest[0]]} ei vielä nouse kohti tavoitetta ${goal}: säännöllisyys ratkaisee.`;
  return txt;
}

function viewProgress() {
  if (!D.placementDone) return viewToday();
  const writings = state.attempts.filter(a => (a.type === 'write' || a.type === 'speak') && a.text).slice(-12).reverse();
  const srsAll = Object.values(D.srs).length, srsDue = Object.values(D.srs).filter(v => v.due <= Date.now()).length;
  main().innerHTML = `<section class="page wide">
    <h1>Edistyminen</h1>
    <div class="overall"><span class="big-cefr">${D.overallCefr.label}</span><div><p class="lead">${analysisSentence()}</p><p>${trendSentence()}</p></div></div>

    <h2>Taidot</h2>
    <div class="multiples">${Object.entries(E.SKILLS).map(([k, n]) => `
      <figure class="mult" data-k="${k}">
        <figcaption><span class="mn">${n}</span><span class="ml">${D.sk[k].cefr.label}</span><span class="mr">${D.sk[k].r}</span><span class="mt">${arrow(D.sk[k].trend)}<small>/vko</small></span></figcaption>
        <div class="chart" data-k="${k}"></div>
      </figure>`).join('')}</div>

    <h2>Heikoimmat alueet</h2>
    ${D.weakTags.length ? `<ul class="tags">${D.weakTags.slice(0, 8).map(t => `<li><span class="tn">${TAGS[t.tag]}</span><i><b style="width:${Math.round(t.acc * 100)}%"></b></i><span class="tv">${Math.round(t.acc * 100)} %</span></li>`).join('')}</ul>` : '<p class="hint">Tarvitaan vielä muutama harjoituskerta.</p>'}
    <p class="hint">Kertausjonossa ${srsAll} tehtävää, joista ${srsDue} erääntynyt. Väli kasvaa 1 → 3 → 7 → 14 → 30 päivään, kun vastaat oikein.</p>

    <h2>Tasotestit</h2>
    <table class="deltas"><thead><tr><th>Päivä</th>${Object.values(E.SKILLS).map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>
      ${[...state.tests].reverse().map(t => `<tr><td>${fmtDate(t.t)}${t.placement ? ' (lähtö)' : ''}</td>${Object.keys(E.SKILLS).map(k => `<td>${t.est?.[k] ? E.cefr(t.est[k]).label : '–'}</td>`).join('')}</tr>`).join('')}
    </tbody></table>

    <h2>Tekstisi</h2>
    ${writings.length ? `<ul class="list">${writings.map(a => `<li><a href="#/review/${a.id}"><span>${fmtDate(a.t)} ${a.type === 'speak' ? 'Puhe' : 'Teksti'}: ${esc(a.title || '')}</span><span class="muted">${a.fb?.score != null ? a.fb.score + '/100' : Math.round(a.score * 100) + ' %'}</span></a></li>`).join('')}</ul>` : '<p class="hint">Ei vielä kirjoituksia.</p>'}
  </section>`;
  $$('.chart').forEach(el => drawChart(el, D.sk[el.dataset.k].hist));
}

// Yhden sarjan aikasarja CEFR-rajoineen + hover-tooltip
function drawChart(el, hist) {
  const pts = hist.slice(-120);
  const W = 320, H = 120, P = { l: 28, r: 8, t: 8, b: 18 };
  if (pts.length < 2) { el.innerHTML = '<p class="hint">Käyrä piirtyy muutaman harjoituksen jälkeen.</p>'; return; }
  const t0 = pts[0].t, t1 = pts.at(-1).t || t0 + 1;
  const rs = pts.map(p => p.r);
  const lo = Math.min(...rs, 950) - 30, hi = Math.max(...rs, 1250) + 30;
  const x = t => P.l + (W - P.l - P.r) * ((t - t0) / Math.max(t1 - t0, 1));
  const y = r => P.t + (H - P.t - P.b) * (1 - (r - lo) / (hi - lo));
  const bands = [1000, 1200, 1400, 1600].filter(b => b > lo && b < hi);
  const bandLbl = { 1000: 'B1', 1200: 'B2', 1400: 'C1', 1600: 'C2' };
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Taso ajan funktiona, nyt ${rs.at(-1)}">
    ${bands.map(b => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(b)}" y2="${y(b)}"/><text class="gl" x="${P.l - 4}" y="${y(b) + 3}" text-anchor="end">${bandLbl[b]}</text>`).join('')}
    <text class="gl" x="${P.l}" y="${H - 4}">${fmtDate(t0)}</text><text class="gl" x="${W - P.r}" y="${H - 4}" text-anchor="end">${fmtDate(t1)}</text>
    <path class="ln" d="${path}"/>
    ${pts.filter(p => p.test).map(p => `<circle class="tp" cx="${x(p.t)}" cy="${y(p.r)}" r="4"/>`).join('')}
    <circle class="end" cx="${x(pts.at(-1).t)}" cy="${y(pts.at(-1).r)}" r="4"/>
    <line class="xh" y1="${P.t}" y2="${H - P.b}" x1="-10" x2="-10"/><circle class="hv" r="4" cx="-10" cy="-10"/>
    <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}"/>
  </svg><div class="tip-box" hidden></div>`;
  const svg = $('svg', el), tip = $('.tip-box', el);
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    let best = pts[0]; for (const p of pts) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    $('.xh', svg).setAttribute('x1', x(best.t)); $('.xh', svg).setAttribute('x2', x(best.t));
    $('.hv', svg).setAttribute('cx', x(best.t)); $('.hv', svg).setAttribute('cy', y(best.r));
    tip.hidden = false; tip.innerHTML = `<strong>${best.r}</strong> ${E.cefr(best.r).label}<br>${fmtDate(best.t)}${best.test ? ' tasotesti' : ''}`;
    tip.style.left = Math.min(r.width - 110, Math.max(0, x(best.t) / W * r.width - 50)) + 'px';
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; $('.xh', svg).setAttribute('x1', -10); $('.xh', svg).setAttribute('x2', -10); $('.hv', svg).setAttribute('cx', -10); });
}

function viewReview(id) {
  const a = state.attempts.find(x => x.id === id);
  if (!a) return go('#/progress');
  const item = E.findItem(state, D, a.itemId);
  main().innerHTML = `<section class="page"><p><a href="#/progress">← Edistyminen</a></p>
    <h1>${esc(a.title || TYPE[a.type])}</h1><p class="hint">${new Date(a.t).toLocaleString('fi-FI')}</p>
    ${item ? `<p class="task">${esc(item.task)}</p>` : ''}
    <div class="fb">${a.fb ? feedbackHTML(a.text, a.fb, item) : `<div class="paper en">${esc(a.text).replace(/\n/g, '<br>')}</div>${item?.model ? `<div class="model"><h3>Mallivastaus</h3><p class="en pre">${esc(item.model)}</p></div>` : ''}`}</div>
    ${item ? `<div class="actions"><button class="btn" id="again">Tee uudelleen</button></div>` : ''}</section>`;
  if (a.fb) bindFeedback($('.fb'), a.fb);
  $('#again')?.addEventListener('click', () => startSession([item.id], 'free'));
}

// ---------- Asetukset ----------
function viewSettings() {
  const p = state.profile;
  const st = settings;
  main().innerHTML = `<section class="page">
    <h1>Asetukset</h1>
    <h2>Tavoite</h2>
    <div class="field-row"><label>Tavoitetaso</label><div class="seg" data-f="goal">${['B1', 'B2', 'C1'].map(g => `<button class="${p.goal === g ? 'on' : ''}" data-v="${g}">${g}</button>`).join('')}</div></div>
    <div class="field-row"><label>Päivittäinen harjoitus</label><div class="seg" data-f="minutes">${[10, 15, 25].map(m => `<button class="${p.minutes === m ? 'on' : ''}" data-v="${m}">${m} min</button>`).join('')}</div></div>
    <div class="field-row"><label for="wd">Työsi kuvaus tekoälylle</label><textarea id="wd" rows="3">${esc(p.workDesc)}</textarea></div>
    <div class="field-row"><label>Kuunteluääni</label><div class="seg" data-f="srLang">${[['en-US', 'Amerikanenglanti'], ['en-GB', 'Brittienglanti']].map(([v, n]) => `<button class="${st.srLang === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>

    <h2>Tekoäly</h2>
    <p class="hint">Ilmainen vaihtoehto: Google Gemini. Hae avain osoitteesta aistudio.google.com → Get API key. Avain tallennetaan vain tälle laitteelle. Huom: ilmaisversiossa Google voi käyttää syötteitä tuotekehitykseen, joten älä kirjoita tehtäviin luottamuksellisia työtietoja.</p>
    <div class="field-row"><label>Palvelu</label><div class="seg" data-f="provider">${[['gemini', 'Gemini'], ['openai', 'OpenAI-yhteensopiva'], ['none', 'Ei tekoälyä']].map(([v, n]) => `<button class="${st.provider === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>
    ${st.provider === 'gemini' ? `
      <div class="field-row"><label for="gk">Gemini API -avain</label><input id="gk" type="password" value="${esc(st.geminiKey || '')}" autocomplete="off"></div>
      <div class="field-row"><label for="gm">Malli</label><div class="inline"><input id="gm" list="gml" value="${esc(st.geminiModel)}"><datalist id="gml"></datalist><button class="btn" id="lm">Hae mallit</button></div></div>` : ''}
    ${st.provider === 'openai' ? `
      <p class="hint">Esim. Groq (ilmainen kiintiö): osoite https://api.groq.com/openai/v1. Tarkista ajantasainen mallinimi palvelun sivuilta.</p>
      <div class="field-row"><label for="ob">API-osoite</label><input id="ob" value="${esc(st.oaiBase)}"></div>
      <div class="field-row"><label for="ok">API-avain</label><input id="ok" type="password" value="${esc(st.oaiKey || '')}" autocomplete="off"></div>
      <div class="field-row"><label for="om">Malli</label><input id="om" value="${esc(st.oaiModel)}"></div>` : ''}
    ${st.provider !== 'none' ? `<div class="actions"><button class="btn" id="aitest">Testaa yhteys</button><span id="aires" class="hint"></span></div>` : ''}

    <h2>Synkronointi puhelimen ja tietokoneen välillä</h2>
    <p class="hint">Historia tallentuu aina ensin tälle laitteelle. Synkronointi yhdistää laitteiden historiat, mitään ei ylikirjoiteta.</p>
    <div class="field-row"><label>Tapa</label><div class="seg" data-f="syncMode">${[['none', 'Ei'], ['gist', 'GitHub Gist'], ['supabase', 'Supabase']].map(([v, n]) => `<button class="${st.syncMode === v ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div></div>
    ${st.syncMode === 'gist' ? `
      <p class="hint">GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate, valitse vain <b>gist</b>. Sama token molemmille laitteille. Data menee yksityiseen (secret) gistiin.</p>
      <div class="field-row"><label for="gt">GitHub-token</label><input id="gt" type="password" value="${esc(st.gistToken || '')}" autocomplete="off"></div>` : ''}
    ${st.syncMode === 'supabase' ? `
      <p class="hint">Ilmaisprojekti pausettuu, jos sitä ei käytetä 7 päivään. Päivittäinen käyttö pitää sen hereillä; data säilyy myös pausella. Ohje: README → Supabase.</p>
      <div class="field-row"><label for="su">Project URL</label><input id="su" value="${esc(st.sbUrl || '')}" placeholder="https://xxxx.supabase.co"></div>
      <div class="field-row"><label for="sk">Publishable (anon) key</label><input id="sk" value="${esc(st.sbKey || '')}"></div>
      <div id="sbauth"></div>` : ''}
    ${st.syncMode !== 'none' ? `<div class="actions"><button class="btn" id="syncnow">Synkronoi nyt</button><span class="hint" id="syncst">${syncInfo.err ? 'Virhe: ' + esc(syncInfo.err) : syncInfo.at ? 'Viimeksi ' + new Date(syncInfo.at).toLocaleString('fi-FI') : ''}</span></div>` : ''}

    <h2>Data</h2>
    <p class="hint">${state.attempts.length} suoritusta, ${state.tests.length} testiä, ${state.gen.length} tekoälytehtävää.</p>
    <div class="actions"><button class="btn" id="exp">Vie varmuuskopio</button><label class="btn">Tuo varmuuskopio<input type="file" id="imp" accept="application/json" hidden></label><button class="btn danger" id="reset">Nollaa kaikki</button></div>
  </section>`;

  $$('.seg').forEach(seg => $$('button', seg).forEach(b => b.onclick = () => {
    const f = seg.dataset.f, v = b.dataset.v;
    if (f === 'goal' || f === 'minutes') { state.profile = { ...state.profile, [f]: f === 'minutes' ? +v : v, updatedAt: Date.now() }; if (f === 'minutes') state.plan = null; save(); refresh(); }
    else saveSettings({ [f]: v });
    viewSettings();
  }));
  $('#wd').onchange = e => { state.profile = { ...state.profile, workDesc: e.target.value.trim(), updatedAt: Date.now() }; save(); toast('Tallennettu'); };
  const bindInput = (sel, key) => { const el = $(sel); if (el) el.onchange = () => saveSettings({ [key]: el.value.trim() }); };
  bindInput('#gk', 'geminiKey'); bindInput('#gm', 'geminiModel'); bindInput('#ob', 'oaiBase'); bindInput('#ok', 'oaiKey'); bindInput('#om', 'oaiModel');
  bindInput('#gt', 'gistToken'); bindInput('#su', 'sbUrl'); bindInput('#sk', 'sbKey');
  $('#gt')?.addEventListener('change', () => saveSettings({ gistId: '' }));
  $('#lm')?.addEventListener('click', async () => {
    try { saveSettings({ geminiKey: $('#gk').value.trim() }); const ms = await AI.listGeminiModels(settings.geminiKey); $('#gml').innerHTML = ms.map(m => `<option value="${esc(m)}">`).join(''); toast(`${ms.length} mallia löytyi. Valitse kentästä; flash-mallit ovat ilmaisia.`); $('#gm').focus(); }
    catch (e) { toast(e.message, true); }
  });
  $('#aitest')?.addEventListener('click', async () => {
    $$('input').forEach(i => i.dispatchEvent(new Event('change')));
    $('#aires').textContent = 'Testataan…';
    try { const r = await AI.aiJSON(settings, 'Reply with JSON only.', 'Return {"ok": true, "msg": "a short friendly English sentence"}'); $('#aires').textContent = r.ok ? `Toimii: ${r.msg || ''}` : 'Vastaus saatiin.'; }
    catch (e) { $('#aires').textContent = e.message; }
  });
  $('#syncnow')?.addEventListener('click', async () => { $$('input').forEach(i => i.dispatchEvent(new Event('change'))); await autoSync(true); viewSettings(); });
  if (settings.syncMode === 'supabase') renderSbAuth();
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `punakyna-${E.dayKey()}.json`; a.click();
  };
  $('#imp').onchange = async e => {
    try { const data = JSON.parse(await e.target.files[0].text()); if (!Array.isArray(data.attempts)) throw new Error(); state = SY.mergeStates(state, data); save(); refresh(); toast('Varmuuskopio yhdistetty.'); viewSettings(); }
    catch { toast('Tiedosto ei ole Punakynän varmuuskopio.', true); }
  };
  $('#reset').onclick = () => {
    if (!confirm('Poistetaanko koko historia tältä laitteelta?')) return;
    if (!confirm('Varmasti? Tätä ei voi perua (pilvikopio säilyy, jos synkronointi on päällä).')) return;
    state = E.emptyState(); save(); refresh(); go('#/today');
  };
}

async function renderSbAuth() {
  const el = $('#sbauth'); if (!el) return;
  if (!settings.sbUrl || !settings.sbKey) { el.innerHTML = '<p class="hint">Täytä URL ja avain, niin voit kirjautua.</p>'; return; }
  try {
    const s = await SY.sbSession(settings);
    if (s) { el.innerHTML = `<p class="hint">Kirjautunut: ${esc(s.user.email)} <button class="link" id="sbout">Kirjaudu ulos</button></p>`; $('#sbout').onclick = async () => { await SY.sbSignOut(settings); renderSbAuth(); }; return; }
    el.innerHTML = `<div class="field-row"><label for="se">Sähköposti</label><input id="se" type="email" autocomplete="email"></div>
      <div class="field-row"><label for="sp">Salasana</label><input id="sp" type="password" autocomplete="current-password"></div>
      <div class="actions"><button class="btn" id="sin">Kirjaudu</button><button class="btn" id="sup">Luo tunnus</button></div>`;
    const doIt = async up => {
      try { await SY.sbSignIn(settings, $('#se').value.trim(), $('#sp').value, up); toast(up ? 'Tunnus luotu. Vahvista sähköpostista, jos Supabase pyytää.' : 'Kirjauduttu.'); renderSbAuth(); }
      catch (e) { toast(e.message, true); }
    };
    $('#sin').onclick = () => doIt(false); $('#sup').onclick = () => doIt(true);
  } catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
}

// ---------- Taustatoiminnot ----------
async function autoSync(manual) {
  if (settings.syncMode === 'none' || syncInfo.busy) return;
  syncInfo.busy = true;
  try {
    const merged = await SY.syncNow(settings, state, saveSettings);
    const changed = merged.attempts.length !== state.attempts.length || merged.tests.length !== state.tests.length || merged.gen.length !== state.gen.length;
    state = merged; save(); refresh();
    syncInfo = { busy: false, err: '', at: Date.now() }; saveSettings({ lastSync: syncInfo.at });
    if (manual) toast('Synkronoitu.');
    if (changed && !session) render();
  } catch (e) {
    syncInfo = { busy: false, err: e.message, at: syncInfo.at };
    if (manual) toast(e.message, true);
  }
}

async function maybeGenerate(force) {
  if (!AI.aiReady(settings) || !D.placementDone) return;
  const attempted = new Set(state.attempts.map(a => a.itemId));
  const fresh = state.gen.filter(g => !attempted.has(g.id)).length;
  if (!force && (fresh >= 6 || Date.now() - (settings.lastGen || 0) < 4 * 3600e3)) return;
  saveSettings({ lastGen: Date.now() });
  const tags = D.weakTags.slice(0, 3).map(t => t.tag);
  try {
    const items = await AI.generateItems(settings, aiCtx(), { tags: tags.length ? tags : ['articles', 'prepositions', 'politeness'], level: D.sk.sentence.cefr.level, rating: D.sk.sentence.r + 40, n: 8 });
    if (items.length) { state.gen.push(...items); save(); refresh(); }
  } catch (e) { if (force) toast(e.message, true); }
}

// ---------- Käynnistys ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && hasTTS) speechSynthesis.cancel();
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
render();
autoSync().then(() => maybeGenerate());
window.__ec = { get state() { return state; }, get D() { return D; }, E }; // vianetsintään selaimen konsolissa
