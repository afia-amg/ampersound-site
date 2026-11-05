'use strict';
// Cue Sheet read path, built for conference-size crews.
//
// 1. Every comment since the current session started is read, page by page. ClickUp returns
//    25 comments per call, so without paging a busy show (check-ins, messages, Got it taps)
//    would quietly drop its oldest check-ins and alerts.
// 2. Vendor page polls share one snapshot in Netlify Blobs. However many crew phones are open,
//    only one function refreshes from ClickUp every few seconds, which keeps a 60-person crew
//    well inside ClickUp's rate limit. ClickUp stays the source of truth: the snapshot is only a
//    short-lived copy, and every write and every coordinator read goes straight to ClickUp.
// 3. If Blobs is missing or fails, reads fall back to ClickUp directly, exactly as before.
let blobs = null;
try { blobs = require('@netlify/blobs'); } catch (_) { blobs = null; }

const PAGE = 25, MAX_PAGES = 40;
const STORE = 'cue-live';
const enc = encodeURIComponent;

async function fetchComments(api, taskId, since) {
  const seen = new Set(), out = [];
  let start = null, startId = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = start ? `?start=${enc(start)}&start_id=${enc(startId)}` : '';
    const r = await api('/task/' + enc(taskId) + '/comment' + qs);
    const list = (r && r.comments) || [];
    let fresh = 0;
    for (const c of list) {
      const id = c && c.id != null ? String(c.id) : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(c); fresh++;
    }
    if (list.length < PAGE || !fresh) break;
    const last = list[list.length - 1];
    const at = Number(last && last.date);
    if (!last || last.id == null || !at) break; // no cursor to page from
    if (at < Number(since || 0)) break; // older pages are rehearsal or earlier sessions
    if (String(last.id) === String(startId)) break;
    start = String(last.date); startId = String(last.id);
  }
  return out;
}

// Only what the Cue Sheet reads, so the shared copy stays small.
function slim(entry) {
  const t = entry.task || {};
  return {
    at: entry.at,
    task: { id: t.id, status: t.status, custom_fields: t.custom_fields || [] },
    comments: (entry.comments || []).map((c) => ({ id: c.id, date: c.date, comment_text: c.comment_text })),
  };
}

function makeLoader({ api, sinceOf, ttl = 4000, sharedTtl = 3000, staleOk = 15000, now = () => Date.now() }) {
  const local = new Map();
  let store = null, warned = false;
  const warn = (msg) => { if (!warned) { warned = true; console.warn('Cue shared cache off:', msg); } };

  function connect(event, injected) {
    store = null;
    if (injected) { store = injected; return; }
    if (!blobs) return warn('package not installed');
    // Only a real Netlify request carries a Blobs context. Tests and builds never touch the live store.
    if (!event || !event.blobs) return warn('no Blobs context on this request');
    try {
      blobs.connectLambda(event);
      store = blobs.getStore({ name: STORE, consistency: 'strong' });
    } catch (e) { store = null; warn(e.message); }
  }

  async function direct(taskId) {
    const task = await api('/task/' + enc(taskId));
    const comments = await fetchComments(api, taskId, sinceOf(task));
    return { at: now(), task, comments };
  }

  async function put(taskId, entry) {
    if (!store) return;
    try { await store.setJSON('snap/' + taskId, slim(entry)); } catch (e) { warn(e.message); }
  }

  // Shared snapshot: fresh enough → use it. Otherwise one function claims the refresh;
  // the others keep serving the slightly older copy until it lands.
  async function shared(taskId) {
    const t = now();
    let snap = null;
    try { snap = await store.get('snap/' + taskId, { type: 'json' }); } catch (e) { warn(e.message); return direct(taskId); }
    if (snap && t - snap.at < sharedTtl) return snap;
    const lock = `lock/${taskId}/${Math.floor(t / sharedTtl)}`;
    let mine = true;
    try { mine = !!(await store.set(lock, '1', { onlyIfNew: true })).modified; } catch (_) { mine = true; }
    if (!mine && snap && t - snap.at < staleOk) return snap;
    const fresh = await direct(taskId);
    await put(taskId, fresh);
    if (mine) { try { await store.delete(lock); } catch (_) { /* expires with its time bucket */ } }
    return fresh;
  }

  async function load(taskId, fresh) {
    const hit = local.get(taskId);
    // With the shared copy on, each function keeps its own copy for 1 second at most,
    // so a phone is never more than about 4 seconds behind ClickUp.
    const keep = store ? Math.min(ttl, 1000) : ttl;
    if (!fresh && hit && now() - hit.at < keep) return hit;
    let entry;
    if (!fresh && store) entry = await shared(taskId);
    else {
      entry = await direct(taskId);
      if (fresh) await put(taskId, entry); // coordinator reads and writes refresh everyone's copy
    }
    local.set(taskId, entry);
    return entry;
  }

  // Writes call this. The local copy goes now; the shared copy ages out within sharedTtl.
  function forget(taskId) {
    local.delete(taskId);
    if (store) store.delete('snap/' + taskId).catch(() => {});
  }

  // Show-flow writes read the Cue State field, change it and write it back. With several rooms
  // calling GO at once, two functions could read the same state and the second write would erase
  // the first GO. This lock lets one write through at a time (claim-a-key with onlyIfNew).
  // A lock older than lockStale is from a function that died mid-write and is taken over.
  async function lock(taskId, { wait = 4000, lockStale = 8000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    if (!store) return async () => {};
    const k = 'wlock/' + taskId, me = Math.random().toString(36).slice(2);
    const until = now() + wait;
    for (;;) {
      let got = false;
      try { got = !!(await store.set(k, JSON.stringify({ at: now(), me }), { onlyIfNew: true })).modified; }
      catch (e) { warn(e.message); return async () => {}; } // store down: same behaviour as before the lock
      if (got) return async () => { try { await store.delete(k); } catch (_) { /* goes stale on its own */ } };
      let held = null;
      try { held = await store.get(k, { type: 'json' }); } catch (_) { held = null; }
      const heldAt = Number(held && held.at);
      if (!held || !Number.isFinite(heldAt) || now() - heldAt > lockStale) { try { await store.delete(k); } catch (_) { /* retry */ } continue; }
      if (now() > until) return null;
      await sleep(120 + Math.floor(Math.random() * 120));
    }
  }

  return { load, connect, forget, lock, local, get usingShared() { return !!store; } };
}

module.exports = { makeLoader, fetchComments, slim, PAGE, MAX_PAGES };
