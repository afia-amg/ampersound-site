/* Coordinator console: /cue/<event>/control. Runs the show; sees vendors and alerts. */
(function () {
  'use strict';
  const { store, esc, fmt, countdown, showNow, stateOf, lane, driftLabel, call, toast, flash, poll } = window.CUE;
  const slug = location.pathname.split('/').filter(Boolean)[1] || '';
  const app = document.getElementById('app');
  const KEY = 'cue:coordinator-key';
  let lastSig = '', key = store.get(KEY) || '', data = null, skew = 0, laneSel = null, busy = false, failed = 0, seenAlerts = null, resetArmed = false, resetTimer = null;

  function gate(err) {
    app.innerHTML = `
      <form class="gate" id="gate">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="Ampersound Media Group" style="height:48px;width:auto;align-self:flex-start">
        <h1>Run the show</h1>
        <p>Enter the coordinator passcode once. This device remembers it.</p>
        <input type="password" id="pass" autocomplete="current-password" aria-label="Coordinator passcode" placeholder="Coordinator passcode" required>
        <div class="err" role="alert">${esc(err || '')}</div>
        <button class="btn" type="button" id="open">Open the console</button>
      </form>`;
    const submit = () => { key = document.getElementById('pass').value.trim(); if (key) { store.set(KEY, key); load(); } };
    document.getElementById('gate').onsubmit = (e) => { e.preventDefault(); submit(); };
    document.getElementById('open').onclick = submit;
    document.getElementById('pass').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    document.getElementById('pass').focus();
  }

  async function load() {
    if (!key) return gate();
    try {
      apply(await call({ e: slug, k: key }));
      failed = 0;
    } catch (e) {
      if (e.status === 401) { store.del(KEY); key = ''; return gate('That passcode didn\'t work.'); }
      if (e.status === 404) { app.innerHTML = '<div class="center"><h2>Event not found</h2><p>Check the link.</p></div>'; return; }
      failed++;
      if (data) render(); else app.innerHTML = `<div class="center"><h2>Can't reach the Cue Sheet</h2><p>${esc(e.message)}. Retrying…</p></div>`;
    }
  }
  function apply(d) {
    skew = d.now - Date.now();
    const ids = d.alerts.map((a) => a.id);
    if (seenAlerts) d.alerts.filter((a) => !seenAlerts.has(a.id)).forEach((a) => toast(`${a.level === 'urgent' ? '🚨' : '📣'} ${a.by}: ${a.text}`));
    seenAlerts = new Set(ids);
    const sig = JSON.stringify([d.state, d.alerts, d.vendors]);
    const same = data && sig === lastSig;
    data = d; lastSig = sig;
    if (!laneSel || !d.event.lanes.includes(laneSel)) laneSel = d.event.lanes[0];
    if (!same) render();
  }
  const laneKey = () => (data.event.lanes.length > 1 ? laneSel : null);

  async function act(body, after) {
    if (busy) return;
    busy = true; render();
    try { apply(await call(null, { e: slug, k: key, ...body })); if (after) after(); }
    catch (e) { toast(e.status === 401 ? 'Passcode changed. Sign in again.' : "Didn't go through. Try again."); if (e.status === 401) { store.del(KEY); key = ''; gate(); } }
    finally { busy = false; if (data && key) render(); }
  }
  function go(m) {
    flash(m.title);
    act({ action: 'go', momentId: m.id }, () => toast(`Started: ${m.title}`, { label: 'Undo', run: () => act({ action: 'undo' }) }));
  }

  function render() {
    if (!data || !key) return;
    const ev = data.event, s = data.state, multi = ev.lanes.length > 1;
    const now = showNow(s, ev.tz, skew);
    const L = lane(data.moments.map((m) => ({ ...m, lane: multi ? m.lane : null })), s, laneKey());
    const hero = L.live || L.next, wrapped = L.started && !L.live && !L.next;
    const left = L.live && now != null ? s.calls[L.live.id].show + L.live.dur - now : null, over = left != null && left < 0;
    const pct = L.live && now != null ? Math.min(100, Math.max(0, ((now - s.calls[L.live.id].show) / L.live.dur) * 100)) : 0;
    const roles = Object.fromEntries(data.vendors.map((v) => [v.id, v.role]));
    const lateBy = Math.round(L.drift);
    const isLive = s.mode === 'live';
    const stale = failed >= 2;

    app.innerHTML = `
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(ev.name)} · Control</b><span>${esc(ev.dateLabel)} · ${esc(ev.venue)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i>${stale ? 'Reconnecting' : 'Live'}</div>
      </header>
      <div class="modes" style="margin-bottom:1rem">
        <span>Clock</span>
        <div class="seg" role="group" aria-label="Clock">
          <button type="button" data-mode="practice" aria-pressed="${!isLive}">Practice</button>
          <button type="button" data-mode="live" aria-pressed="${isLive}">Show day</button>
        </div>
        <span>${isLive ? 'Using real time for running late' : 'Practice clock starts at your first GO'}</span>
      </div>
      <div class="grid">
        <div>
          <section class="desk">
            ${multi ? `<div class="lanes" role="group" aria-label="Stage or room">${ev.lanes.map((l) => `<button type="button" data-lane="${esc(l)}" aria-pressed="${l === laneSel}">${esc(l)}</button>`).join('')}</div>` : ''}
            <div class="kicker ${L.live ? 'live' : ''}">${L.live ? 'Happening now' : wrapped ? 'Done for the day' : 'Up next'}${hero && !wrapped ? ' · ' + fmt(hero.time) + (hero.location ? ' · ' + esc(hero.location) : '') : ''}</div>
            <div class="big">${esc(wrapped ? "That's a wrap." : hero ? hero.title : 'Nothing scheduled')}</div>
            ${hero && !wrapped ? `<div class="meta">${esc((hero.vendors || []).map((id) => roles[id]).filter(Boolean).join(' · '))}</div>` : ''}
            ${L.live ? `<div style="margin-top:0.9rem"><div class="bar"><i id="barfill" class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
              <div class="left"><span>Started ${fmt(s.calls[L.live.id].show)}</span><b id="leftval" class="${over ? 'over' : ''}">${left == null ? '' : over ? countdown(left) + ' over' : countdown(left) + ' left'}</b></div></div>` : ''}
            <div class="clock">
              <div><b id="clockval">${fmt(now != null ? now : hero ? hero.time : 0).replace(/ (AM|PM)/, '<small>$1</small>')}</b><div class="meta">${isLive ? 'Real time' : now == null ? 'Practice clock, waiting for GO' : 'Practice clock'}</div></div>
              ${L.started ? `<span class="pill ${lateBy > 0 ? 'late' : ''}">${driftLabel(L.drift)}</span>` : ''}
            </div>
            ${L.live && L.next ? `<div class="meta" style="margin-bottom:0.25rem">Next: <b style="color:var(--text)">${esc(L.next.title)}</b> · ${lateBy ? 'now about ' + fmt(L.next.time + L.drift) : fmt(L.next.time)}</div>` : ''}
            <div class="ctrl">
              <button class="btn go" id="go" type="button" ${!L.next || busy ? 'disabled' : ''}>GO <small>${L.next ? esc(L.next.title) : 'Nothing left'}</small></button>
              ${L.live ? '<button class="btn ghost" id="finish" type="button">Finish</button>' : ''}
            </div>
            <p class="meta" style="margin-top:0.6rem">Tap GO the moment it starts. Every vendor's phone updates within seconds. Space bar works too.</p>
          </section>
          <h2 class="h2" style="margin-top:1.5rem">Schedule</h2>
          <ol class="list sched">
            ${L.rows.map((m) => { const st = stateOf(m, s), nx = L.next && L.next.id === m.id; return `<li class="${st === 'live' ? 'now' : st === 'done' ? 'done' : nx ? 'next' : ''}"><span class="t">${fmt(m.time)}${st === 'pending' && lateBy ? `<small style="display:block;color:${lateBy > 0 ? 'var(--bad)' : 'var(--gold-text)'};font-family:var(--body);font-weight:400;font-size:.875rem">~${fmt(m.time + L.drift)}</small>` : ''}</span><span class="x">${esc(m.title)}<small>${esc([m.location, (m.vendors || []).map((id) => roles[id]).filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small></span>${st === 'pending' ? `<button class="go" type="button" data-go="${esc(m.id)}" aria-label="GO: start ${esc(m.title)}">GO</button>` : st === 'live' ? '<span class="meta">Now</span>' : '✓'}</li>`; }).join('')}
          </ol>
          <div class="row2" style="margin-top:1rem">
            <button class="btn ghost" id="undo" type="button" ${Object.keys(s.calls).length ? '' : 'disabled'}>Undo last GO</button>
            <button class="btn ghost" id="reset" type="button" aria-live="polite" style="${resetArmed ? 'border-color:var(--bad);color:var(--bad)' : ''}">${resetArmed ? 'Tap again to reset' : 'Reset the day'}</button>
          </div>
        </div>
        <div>
          <h2 class="h2">Alerts</h2>
          ${data.alerts.length ? `<ul class="alerts">${data.alerts.slice(0, 8).map((a) => `<li><i class="dot ${a.level === 'urgent' ? 'bad' : ''}"></i><div><div>${esc(a.text)}</div><small>${esc(a.by)} · ${fmt(a.show)}</small></div></li>`).join('')}</ul>` : '<p class="meta" style="margin-bottom:1rem">Quiet so far. Vendor alerts show up here and in ClickUp.</p>'}
          <h2 class="h2" style="margin-top:1.5rem">Vendors · ${data.vendors.filter((v) => v.checkedIn).length} of ${data.vendors.length} here</h2>
          <ul class="vend">
            ${data.vendors.map((v) => { const late = isLive && !v.checkedIn && now != null && now > v.arrival; const phone = /^[+\d][\d\s().-]{6,}$/.test(v.contact || '') ? v.contact.replace(/[^\d+]/g, '') : ''; const body = encodeURIComponent(`Hi ${v.name}! Here's your live timeline for ${ev.name} (${ev.dateLabel}). No login needed: ${v.link}  - ${ev.coordinator.name}, Ampersound`); return `<li><div class="x"><b>${esc(v.name)}</b><small class="${v.checkedIn ? 'in' : late ? 'late' : ''}">${esc(v.role)} · ${v.checkedIn ? 'Here since ' + fmt(v.checkedIn.show) : late ? 'Late, due ' + fmt(v.arrival) : 'Arrive by ' + fmt(v.arrival)}</small></div><a class="icon" href="sms:${esc(phone)}?&body=${body}" aria-label="Text ${esc(v.name)} their link">Text</a><button class="icon" type="button" data-copy="${esc(v.link)}" aria-label="Copy ${esc(v.name)}'s link">Copy</button></li>`; }).join('')}
          </ul>
          <p class="meta" style="margin-top:0.75rem">Each link is private to that vendor. To turn one off, ask Brain to reset that vendor's link.</p>
        </div>
      </div>
      <p class="foot">Ampersound Media Group · Sound. Presence. Atmosphere. · <button type="button" id="signout" style="background:none;border:none;color:var(--gold-text);cursor:pointer;font-size:inherit">Sign out on this device</button></p>`;

    const $ = (id) => document.getElementById(id);
    if ($('go')) $('go').onclick = () => L.next && go(L.next);
    if ($('finish')) $('finish').onclick = () => act({ action: 'finish', momentId: L.live.id });
    $('undo').onclick = () => act({ action: 'undo' }, () => toast('Last GO undone'));
    // Two taps instead of a browser pop-up: pop-ups are blocked inside some phone browsers.
    $('reset').onclick = () => {
      if (!resetArmed) {
        resetArmed = true;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { resetArmed = false; render(); }, 5000);
        render();
        toast('Tap Reset again to clear every GO and check-in. The schedule stays.');
        return;
      }
      resetArmed = false;
      clearTimeout(resetTimer);
      act({ action: 'reset' }, () => toast('Day reset'));
    };
    $('signout').onclick = () => { store.del(KEY); key = ''; data = null; gate(); };
    app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const m = data.moments.find((x) => x.id === b.dataset.go); if (m) go(m); }));
    app.querySelectorAll('[data-lane]').forEach((b) => (b.onclick = () => { laneSel = b.dataset.lane; render(); }));
    app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { if ((b.dataset.mode === 'live') !== isLive) act({ action: 'mode', mode: b.dataset.mode }); }));
    app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch (_) { prompt('Copy this link', b.dataset.copy); } }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !data || !key || /^(INPUT|TEXTAREA|BUTTON|A|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    const multi = data.event.lanes.length > 1;
    const L = lane(data.moments.map((m) => ({ ...m, lane: multi ? m.lane : null })), data.state, laneKey());
    if (L.next) { e.preventDefault(); go(L.next); }
  });

  // Every second, update only the clock and countdown so buttons never move under a finger.
  function tick() {
    if (!data || !key) return;
    const ev = data.event, s = data.state, multi = ev.lanes.length > 1;
    const now = showNow(s, ev.tz, skew);
    const L = lane(data.moments.map((m) => ({ ...m, lane: multi ? m.lane : null })), s, laneKey());
    const c = document.getElementById('clockval');
    if (c && now != null) c.innerHTML = fmt(now).replace(/ (AM|PM)/, '<small>$1</small>');
    if (L.live && now != null) {
      const left = s.calls[L.live.id].show + L.live.dur - now, over = left < 0;
      const lv = document.getElementById('leftval'), bf = document.getElementById('barfill');
      if (lv) { lv.textContent = over ? countdown(left) + ' over' : countdown(left) + ' left'; lv.className = over ? 'over' : ''; }
      if (bf) { bf.style.width = Math.min(100, Math.max(0, ((now - s.calls[L.live.id].show) / L.live.dur) * 100)) + '%'; bf.className = over ? 'over' : ''; }
    }
  }
  poll(load, 6000);
  setInterval(tick, 1000);
})();
