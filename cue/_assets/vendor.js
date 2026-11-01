/* Vendor page: /cue/<event>/<private-link-code>. No login; the code is the pass. */
(function () {
  'use strict';
  const { store, esc, fmt, showNow, stateOf, call, toast, flash, poll } = window.CUE;
  const parts = location.pathname.split('/').filter(Boolean); // ["cue", event, code]
  const slug = parts[1] || '', code = parts[2] || '';
  const app = document.getElementById('app');
  let lastSig = '', data = null, skew = 0, lastLive = null, failed = 0, level = 'note', sending = false;
  const doneKey = `cue:${slug}:${code}:checkin`;

  function render() {
    if (!data) return;
    const ev = data.event, v = data.vendor, s = data.state, moments = data.moments;
    const now = showNow(s, ev.tz, skew);
    const ordered = moments.slice().sort((a, b) => a.time - b.time);
    const live = ordered.filter((m) => stateOf(m, s) === 'live').sort((a, b) => (s.calls[b.id].seq || s.calls[b.id].at) - (s.calls[a.id].seq || s.calls[a.id].at))[0] || null;
    const mine = ordered.filter((m) => (m.vendors || []).includes(v.id));
    const myLive = mine.find((m) => stateOf(m, s) === 'live');
    const myNext = mine.find((m) => stateOf(m, s) === 'pending');
    const hero = myLive || myNext;
    const checked = v.checkedIn || (store.get(doneKey) ? { show: Number(store.get(doneKey)) } : null);
    const stale = failed >= 2;

    app.innerHTML = `
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(ev.name)}</b><span>${esc(ev.dateLabel)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i>${stale ? 'Reconnecting' : 'Live'}</div>
      </header>
      ${stale ? '<div class="banner">No signal right now. This page catches up the moment you\'re back online.</div>' : ''}
      <h1 class="hi">Hi, ${esc(v.name)}</h1>
      ${checked
        ? `<div class="here">✓ Checked in${checked.show != null && !Number.isNaN(checked.show) ? ' at ' + fmt(checked.show) : ''}</div>`
        : `<section class="card">
            <div class="arrive">📍 <span>Arrive by <b>${fmt(v.arrival)}</b> · ${esc(ev.venue)}</span></div>
            <button class="btn" id="checkin" type="button">I'm here, check me in</button>
          </section>`}
      <section class="card">
        <div class="kicker ${myLive ? 'live' : ''}">${myLive ? "You're on now" : hero ? 'Your next moment' : "You're all done"}</div>
        <div class="big">${esc(hero ? hero.title : 'Thank you!')}</div>
        ${hero ? `<div class="meta">${fmt(hero.time)}${hero.location ? ' · ' + esc(hero.location) : ''}${myLive && now != null ? ' · ' + timeLeft(myLive, s, now) : ''}</div>` : ''}
        ${hero && hero.notes ? `<div class="note">${esc(hero.notes)}</div>` : ''}
      </section>
      <div class="nowline"><i class="dot ${live ? 'live' : ''}"></i><span>At the event now:</span><b>${esc(live ? live.title : 'Starting soon')}</b></div>
      <div class="label">Your day</div>
      <ol class="list">
        ${mine.map((m) => { const st = stateOf(m, s); return `<li class="${st === 'live' ? 'now' : st === 'done' ? 'done' : ''}"><span class="t">${fmt(m.time)}</span><span class="x">${esc(m.title)}<small>${esc(m.location || '')}</small></span>${st === 'done' ? '✓' : ''}</li>`; }).join('')}
      </ol>
      <div class="row2" style="margin-top:1rem">
        <button class="btn ghost" id="alert" type="button">📣 Send alert</button>
        <a class="btn ghost" href="tel:${esc(ev.coordinator.phone)}">📞 Call ${esc(ev.coordinator.name)}</a>
      </div>
      <p class="foot">No account needed. This page always shows the latest.<br>${esc(ev.coordinator.name)} · ${esc(ev.coordinator.phoneLabel)}</p>`;

    const ci = document.getElementById('checkin');
    if (ci) ci.onclick = checkIn;
    document.getElementById('alert').onclick = openSheet;
  }
  function timeLeft(m, s, now) {
    const left = s.calls[m.id].show + m.dur - now;
    return left >= 0 ? `${Math.ceil(left)} min left` : `${Math.ceil(-left)} min over`;
  }

  async function load() {
    try {
      const d = await call({ e: slug, t: code });
      skew = d.now - Date.now();
      const live = d.moments.filter((m) => stateOf(m, d.state) === 'live').sort((a, b) => (d.state.calls[b.id].seq || d.state.calls[b.id].at) - (d.state.calls[a.id].seq || d.state.calls[a.id].at))[0];
      if (data && live && live.id !== lastLive) flash(live.title, (live.vendors || []).includes(d.vendor.id) ? "That's you" : '');
      lastLive = live ? live.id : null;
      if (d.vendor.checkedIn) store.del(doneKey);
      const sig = JSON.stringify([d.state, d.vendor]);
      const same = data && sig === lastSig && failed === 0;
      data = d; lastSig = sig; failed = 0;
      if (!same) render();
    } catch (e) {
      if (e.status === 404 || e.status === 401) return gone();
      failed++;
      if (data) render(); else app.innerHTML = `<div class="center"><h2>Can't reach the Cue Sheet</h2><p>Check your signal. This page will keep trying.</p></div>`;
    }
  }
  function gone() {
    app.innerHTML = `<div class="center"><img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="" style="height:48px;opacity:.6"><h2>This link is turned off</h2><p>Ask your coordinator for a new one.</p></div>`;
  }

  async function checkIn() {
    const b = document.getElementById('checkin');
    b.disabled = true; b.textContent = 'Checking you in…';
    try {
      const r = await call(null, { e: slug, t: code, action: 'checkin' });
      store.set(doneKey, String(r.show));
      toast("You're checked in. The coordinator can see it.");
      render();
    } catch (e) {
      b.disabled = false; b.textContent = "I'm here, check me in";
      toast("Didn't go through. Check your signal and try again.");
    }
  }

  // Alert sheet
  const scrim = document.querySelector('.scrim'), sheet = document.querySelector('.sheet');
  const text = sheet.querySelector('textarea'), send = sheet.querySelector('#send');
  function openSheet() { scrim.classList.add('open'); sheet.classList.add('open'); sheet.removeAttribute('inert'); setTimeout(() => text.focus(), 250); }
  function closeSheet() { scrim.classList.remove('open'); sheet.classList.remove('open'); sheet.setAttribute('inert', ''); }
  scrim.onclick = closeSheet;
  sheet.querySelector('.x').onclick = closeSheet;
  sheet.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => {
    level = b.dataset.level;
    sheet.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  text.oninput = () => (send.disabled = !text.value.trim() || sending);
  send.onclick = async () => {
    const msg = text.value.trim();
    if (!msg) return;
    sending = true; send.disabled = true; send.textContent = 'Sending…';
    try {
      await call(null, { e: slug, t: code, action: 'alert', text: msg, level });
      text.value = ''; closeSheet(); toast('Sent. The coordinator has it.');
    } catch (e) {
      toast("Didn't send. Your message is still there, try again.");
    } finally {
      sending = false; send.textContent = 'Send to coordinator'; send.disabled = !text.value.trim();
    }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  if (!slug || !code) gone(); else poll(load, 12000);
  setInterval(() => { if (!document.querySelector('.sheet.open')) render(); }, 60000);
})();
