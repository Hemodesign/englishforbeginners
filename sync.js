// Synkronointi laitteiden välillä. Data on aina ensisijaisesti laitteella;
// pilvikopio yhdistetään (ei ylikirjoiteta), joten mitään ei häviä vaikka yhteys katkeaisi.
const FILE = 'english-coach.json';
const DESC = 'english-coach-sync';

export function mergeStates(a, b) {
  if (!b) return a; if (!a) return b;
  const byId = (x, y) => {
    const m = new Map();
    for (const it of [...(x || []), ...(y || [])]) {
      const cur = m.get(it.id);
      if (!cur || (!cur.fb && it.fb)) m.set(it.id, it);
    }
    return [...m.values()].sort((p, q) => (p.t || p.created || 0) - (q.t || q.created || 0));
  };
  const profile = (a.profile?.updatedAt || 0) >= (b.profile?.updatedAt || 0) ? a.profile : b.profile;
  let plan = a.plan;
  if (b.plan && (!a.plan || b.plan.date > a.plan.date)) plan = b.plan;
  else if (b.plan && a.plan && b.plan.date === a.plan.date) plan = { ...a.plan, done: [...new Set([...(a.plan.done || []), ...(b.plan.done || [])])] };
  return {
    v: 1, created: Math.min(a.created || Date.now(), b.created || Date.now()), profile, plan,
    attempts: byId(a.attempts, b.attempts),
    tests: byId(a.tests, b.tests),
    gen: byId(a.gen, b.gen).slice(-400),
    updatedAt: Date.now(),
  };
}

// ---------- GitHub Gist (ilmainen, ei nukahda) ----------
async function gh(token, path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error('GitHub-token ei kelpaa.');
  if (res.status === 404) throw new Error('Gistiä ei löytynyt. Tarkista tokenin gist-oikeus.');
  if (!res.ok) throw new Error(`GitHub-virhe ${res.status}`);
  return res.json();
}

async function gistFind(token) {
  const list = await gh(token, '/gists?per_page=100');
  return list.find(g => g.description === DESC && g.files?.[FILE])?.id || null;
}

export async function gistPull(st) {
  let id = st.gistId || await gistFind(st.gistToken);
  if (!id) return { id: null, data: null };
  const g = await gh(st.gistToken, `/gists/${id}`);
  const f = g.files?.[FILE];
  if (!f) return { id, data: null };
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url)).text();
  return { id, data: content ? JSON.parse(content) : null };
}

export async function gistPush(st, id, data) {
  const body = JSON.stringify({ description: DESC, files: { [FILE]: { content: JSON.stringify(data) } } });
  if (id) { await gh(st.gistToken, `/gists/${id}`, { method: 'PATCH', body }); return id; }
  const g = await gh(st.gistToken, '/gists', { method: 'POST', body: JSON.stringify({ description: DESC, public: false, files: { [FILE]: { content: JSON.stringify(data) } } }) });
  return g.id;
}

// ---------- Supabase ----------
let sb = null, sbKey = '';
async function client(st) {
  const k = st.sbUrl + '|' + st.sbKey;
  if (sb && sbKey === k) return sb;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(st.sbUrl, st.sbKey, { auth: { persistSession: true, storageKey: 'ec-sb-auth' } });
  sbKey = k;
  return sb;
}
export async function sbSession(st) {
  if (!st.sbUrl || !st.sbKey) return null;
  const c = await client(st);
  const { data } = await c.auth.getSession();
  return data.session;
}
export async function sbSignIn(st, email, password, signUp = false) {
  const c = await client(st);
  const r = signUp ? await c.auth.signUp({ email, password }) : await c.auth.signInWithPassword({ email, password });
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function sbSignOut(st) { const c = await client(st); await c.auth.signOut(); }
export async function sbPull(st) {
  const c = await client(st);
  const s = await sbSession(st); if (!s) throw new Error('Kirjaudu Supabaseen asetuksissa.');
  const { data, error } = await c.from('progress').select('data').eq('user_id', s.user.id).maybeSingle();
  if (error) throw new Error(friendlySb(error));
  return data?.data || null;
}
export async function sbPush(st, payload) {
  const c = await client(st);
  const s = await sbSession(st); if (!s) throw new Error('Kirjaudu Supabaseen asetuksissa.');
  const { error } = await c.from('progress').upsert({ user_id: s.user.id, data: payload, updated_at: new Date().toISOString() });
  if (error) throw new Error(friendlySb(error));
}
function friendlySb(e) {
  if (/relation .*progress.* does not exist|Could not find the table/i.test(e.message)) return 'Taulua "progress" ei ole. Aja supabase/schema.sql Supabasen SQL-editorissa.';
  if (/Failed to fetch|NetworkError/i.test(e.message)) return 'Supabase ei vastaa. Projekti voi olla pausella – avaa Supabase-hallinta ja valitse Resume project.';
  return e.message;
}

// ---------- Yhteinen ----------
export async function syncNow(settings, local, saveSettings) {
  if (settings.syncMode === 'gist') {
    if (!settings.gistToken) throw new Error('Lisää GitHub-token asetuksiin.');
    const { id, data } = await gistPull(settings);
    const merged = mergeStates(local, data);
    const newId = await gistPush(settings, id, merged);
    if (newId !== settings.gistId) saveSettings({ gistId: newId });
    return merged;
  }
  if (settings.syncMode === 'supabase') {
    const remote = await sbPull(settings);
    const merged = mergeStates(local, remote);
    await sbPush(settings, merged);
    return merged;
  }
  return local;
}
