/* Ampersound Cue Sheet: shared helpers for the vendor page and the coordinator console. */
(function () {
  'use strict';
  const API = '/.netlify/functions/cue';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (min) => {
    if (min == null || Number.isNaN(min)) return '--:--';
    const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
    return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  const countdown = (min) => {
    const s = Math.max(0, Math.floor(Math.abs(min) * 60)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  function wall(ms, tz) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Denver', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const g = (k) => Number((p.find((x) => x.type === k) || {}).value || 0);
    return g('hour') * 60 + g('minute') + g('second') / 60;
  }
  // Real-world clock time of a timestamp at the event, for "last synced" labels.
  const at = (ms, tz) => (ms ? fmt(wall(ms, tz)) : '--:--');
  const ago = (ms) => {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`;
  };
  function showNow(state, tz, skew) {
    const ms = Date.now() + (skew || 0);
    if (state.mode === 'live') return wall(ms, tz);
    if (!state.anchor) return null;
    return state.anchor.show + (ms - state.anchor.real) / 60000;
  }
  function stateOf(m, s) {
    if (s.done[m.id]) return 'done';
    if (s.calls[m.id]) return 'live';
    return 'pending';
  }
  function lane(moments, s, laneName) {
    const rows = moments.filter((m) => (m.lane || null) === (laneName || null)).sort((a, b) => a.time - b.time);
    const order = (id) => s.calls[id].seq || s.calls[id].at;
    const live = rows.filter((m) => stateOf(m, s) === 'live').sort((a, b) => order(b.id) - order(a.id))[0] || null;
    const next = rows.find((m) => stateOf(m, s) === 'pending') || null;
    const called = rows.filter((m) => s.calls[m.id]).sort((a, b) => order(a.id) - order(b.id));
    const last = called[called.length - 1];
    const drift = last ? s.calls[last.id].show - last.time : 0;
    return { rows, live, next, drift, started: called.length > 0 };
  }
  const driftLabel = (d) => { const r = Math.round(d); return r === 0 ? 'On time' : r > 0 ? `${r} min behind` : `${-r} min ahead`; };

  async function call(params, body) {
    // Copy before removing the key: never serialize coordinator credentials into URLs or bodies.
    const payload = { ...(body || params || {}) };
    const key = payload.k;
    delete payload.k;
    const headers = {};
    if (key) headers.Authorization = 'Bearer ' + key;
    const opts = { headers, cache: 'no-store', redirect: 'error' };
    if (body) {
      opts.method = 'POST';
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(payload);
    }
    const url = body ? API : API + '?' + new URLSearchParams(payload).toString();
    const r = await fetch(url, opts);
    let data = {};
    try { data = await r.json(); } catch (_) { /* empty */ }
    if (!r.ok || !data.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = r.status; e.data = data; throw e; }
    return data;
  }

  function toast(text, action) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '');
    if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), action ? 8000 : 3500);
  }
  function flash(title, sub) {
    let el = document.querySelector('.flash');
    if (!el) { el = document.createElement('div'); el.className = 'flash'; el.setAttribute('aria-live', 'assertive'); document.body.appendChild(el); }
    el.innerHTML = `<b>GO</b><span>${esc(title)}</span>${sub ? `<em>${esc(sub)}</em>` : ''}`;
    el.classList.add('show');
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch (_) { /* ignore */ } }
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1600);
  }
  function buzz(pattern) { if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) { /* ignore */ } } }
  function poll(fn, every) {
    let timer = null;
    const tick = async () => { clearTimeout(timer); try { await fn(); } finally { timer = setTimeout(tick, document.hidden ? every * 4 : every); } };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    window.addEventListener('online', tick);
    tick();
    return tick;
  }
  const mem = {};
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return k in mem ? mem[k] : null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { mem[k] = String(v); } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { delete mem[k]; } },
  };
  window.CUE = { store, esc, fmt, countdown, at, ago, showNow, stateOf, lane, driftLabel, call, toast, flash, buzz, poll };
})();
