/* Vendor page: /cue/<event>/<private-link-code>. No login; the code is the pass. */
(function () {
  'use strict';
  const { store, esc, fmt, at, ago, showNow, stateOf, lane, call, toast, flash, buzz, poll } = window.CUE;
  const parts = location.pathname.split('/').filter(Boolean); // ["cue", event, code]
  const slug = parts[1] || '', code = parts[2] || '';
  const app = document.getElementById('app');
  const URGENT_WAIT = 2 * 60 * 1000; // unanswered urgent alert: tell the vendor to call
  let lastSig = '', data = null, skew = 0, lastLive = null, failed = 0, level = 'note', sending = false, lastOk = 0, savedCopy = false, refresh = null;
  let seenMsgs = null; const marking = new Set();
  const doneKey = `cue:${slug}:${code}:checkin`, lastKey = `cue:${slug}:${code}:last`;

  function localCheckin(session) {
    try { const c = JSON.parse(store.get(doneKey) || 'null'); return c && c.session === session ? c : null; } catch (_) { return null; }
  }
  // After close out: a thank-you and the Google review link. Nothing else to do.
  function renderClosed() {
    const ev = data.event, v = data.vendor, r = data.review || {};
    app.innerHTML = `<section class="thanks">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="Ampersound Media Group">
        <div class="kicker live">${esc(ev.name)} · ${esc(ev.dateLabel)}</div>
        <div class="big">That's a wrap.</div>
        <p class="lede">Thank you, ${esc(v.name)}. Working beside you is what made the day run.</p>
        <p class="ask">If we earned it, a Google review helps a small team more than almost anything. It takes a minute.</p>
        <a class="btn" id="review" href="${esc(r.url)}" target="_blank" rel="noopener">⭐ Leave us a Google review</a>
        ${r.tapped ? '<p class="meta done">Thank you! If the review page didn\'t open, tap the button again.</p>' : ''}
        <p class="foot">From Afia &amp; Adam · Ampersound Media Group<br>Sound. Presence. Atmosphere.</p>
      </section>`;
    // Count the tap, but never block the link on it: the review page opens either way.
    document.getElementById('review').onclick = () => {
      if (r.tapped) return;
      r.tapped = true;
      call(null, { e: slug, t: code, action: 'review' }).catch(() => { r.tapped = false; });
      setTimeout(render, 300);
    };
  }
  function render() {
    if (!data) return;
    if (data.closed) return renderClosed();
    const ev = data.event, v = data.vendor, s = data.state, moments = data.moments;
    const now = showNow(s, ev.tz, skew);
    const ordered = moments.slice().sort((a, b) => a.time - b.time);
    const live = ordered.filter((m) => stateOf(m, s) === 'live').sort((a, b) => (s.calls[b.id].seq || s.calls[b.id].at) - (s.calls[a.id].seq || s.calls[a.id].at))[0] || null;
    const mine = ordered.filter((m) => (m.vendors || []).includes(v.id));
    const myLive = mine.find((m) => stateOf(m, s) === 'live');
    const myNext = mine.find((m) => stateOf(m, s) === 'pending');
    const hero = myLive || myNext;
    // Running late or early: shift pending times by the drift of that moment's stage.
    const drift = (m) => Math.round(lane(moments, s, m.lane || null).drift);
    const when = (m) => { const d = stateOf(m, s) === 'pending' ? drift(m) : 0; return d ? `~${fmt(m.time + d)} <s>${fmt(m.time)}</s>` : fmt(m.time); };
    const lateBy = hero ? drift(hero) : 0;
    const local = localCheckin(s.session);
    const checked = v.checkedIn || (local ? { show: Number(local.show) } : null);
    const stale = failed >= 2 || savedCopy;
    const alerts = data.myAlerts || [];
    const msgs = data.broadcasts || [], fresh = msgs.filter((b) => !b.gotIt), read = msgs.filter((b) => b.gotIt);
    const waiting = alerts.filter((a) => a.level === 'urgent' && !a.ack && !a.resolved && Date.now() + skew - a.at > URGENT_WAIT);

    app.innerHTML = `
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(ev.name)}</b><span>${esc(ev.dateLabel)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i><span id="syncval">${stale ? 'Offline' : 'Updated ' + ago(lastOk)}</span></div>
      </header>
      ${stale ? `<div class="banner" role="alert">${savedCopy ? 'No signal. This is your saved copy' : 'No signal since ' + esc(at(lastOk, ev.tz))}. Times may be out of date. If anything feels off, call ${esc(ev.coordinator.name)}.</div>` : ''}
      ${waiting.length ? `<div class="banner" role="alert">🚨 ${esc(ev.coordinator.name)} hasn't seen your urgent alert yet. ${ev.coordinator.phone ? `<a href="tel:${esc(ev.coordinator.phone)}"><b>Call now</b></a>` : '<b>Find them in person now.</b>'}</div>` : ''}
      ${fresh.map((b) => `<section class="card msg ${b.level === 'urgent' ? 'urgent' : ''}" role="alert">
        <div class="kicker">${b.level === 'urgent' ? '🚨 Urgent' : b.direct ? '💬 Just for you' : '📢 To everyone'}${b.level === 'urgent' && b.direct ? ' · Just for you' : ''} · Coordinator · ${fmt(b.show)}</div>
        <div class="msg-text">${esc(b.text)}</div>
        <button class="btn" type="button" data-gotit="${esc(b.id)}" ${stale || marking.has(b.id) ? 'disabled' : ''}>${marking.has(b.id) ? 'Sending…' : 'Got it'}</button>
      </section>`).join('')}
      <h1 class="hi">Hi, ${esc(v.name)}</h1>
      ${checked
        ? `<div class="here">✓ Checked in${checked.show != null && !Number.isNaN(checked.show) ? ' at ' + fmt(checked.show) : ''}</div>`
        : `<section class="card">
            <div class="arrive">📍 <span>Arrive by <b>${fmt(v.arrival)}</b> · ${esc(ev.venue)}</span></div>
            <button class="btn" id="checkin" type="button" ${stale ? 'disabled' : ''}>I'm here, check me in</button>
            ${stale ? '<p class="meta" style="margin-top:0.5rem">Check-in needs signal. Text or call instead.</p>' : ''}
          </section>`}
      <section class="card">
        <div class="kicker ${myLive ? 'live' : ''}">${myLive ? "You're on now" : hero ? 'Your next moment' : "You're all done"}</div>
        <div class="big">${esc(hero ? hero.title : 'Thank you!')}</div>
        ${hero ? `<div class="meta">${when(hero)}${hero.location ? ' · ' + esc(hero.location) : ''}${myLive && now != null ? ' · ' + timeLeft(myLive, s, now) : ''}</div>` : ''}
        ${hero && !myLive && lateBy ? `<div class="note">${lateBy > 0 ? `Running about ${lateBy} min behind.` : `Running about ${-lateBy} min ahead.`} Times below are adjusted.</div>` : ''}
        ${hero && hero.notes ? `<div class="note">${esc(hero.notes)}</div>` : ''}
      </section>
      <div class="nowline"><i class="dot ${live ? 'live' : ''}"></i><span>At the event now:</span><b>${esc(live ? live.title : 'Starting soon')}</b></div>
      <div class="label">Your day</div>
      <ol class="list">
        ${mine.map((m) => { const st = stateOf(m, s); return `<li class="${st === 'live' ? 'now' : st === 'done' ? 'done' : ''}"><span class="t">${when(m)}</span><span class="x">${esc(m.title)}<small>${esc(m.location || '')}</small></span>${st === 'done' ? '✓' : ''}</li>`; }).join('')}
      </ol>
      ${alerts.length ? `<div class="label">Your alerts</div><ul class="alerts">${alerts.map((a) => `<li><i class="dot ${a.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(a.text)}</div><small>${fmt(a.show)} · <span class="st ${a.resolved ? 'ok' : a.ack ? '' : 'new'}">${a.resolved ? 'Resolved' : a.ack ? 'Seen by ' + esc(ev.coordinator.name) : 'Not seen yet'}</span></small></div></li>`).join('')}</ul>` : ''}
      ${read.length ? `<div class="label">Messages from the coordinator</div><ul class="alerts">${read.map((b) => `<li><i class="dot ${b.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(b.text)}</div><small>${b.direct ? 'Just for you · ' : ''}${fmt(b.show)} · <span class="st ok">✓ Got it</span></small></div></li>`).join('')}</ul>` : ''}
      <div class="${ev.coordinator.phone ? 'row2' : ''}" style="margin-top:1rem">
        <button class="btn ghost" id="alert" type="button" ${stale ? 'disabled' : ''}>📣 Send alert</button>
        ${ev.coordinator.phone ? `<a class="btn ghost" href="tel:${esc(ev.coordinator.phone)}">📞 Call ${esc(ev.coordinator.name)}</a>` : ''}
      </div>
      <p class="foot">No account needed. Urgent? Send the alert${ev.coordinator.phone ? ' and call' : ''}.<br>Point of contact: ${esc(ev.coordinator.name)}${ev.coordinator.phoneLabel ? ' · ' + esc(ev.coordinator.phoneLabel) : ''}</p>`;

    const ci = document.getElementById('checkin');
    if (ci) ci.onclick = checkIn;
    document.getElementById('alert').onclick = openSheet;
    app.querySelectorAll('[data-gotit]').forEach((b) => (b.onclick = () => gotIt(b.dataset.gotit)));
  }
  async function gotIt(id) {
    if (marking.has(id)) return;
    marking.add(id); render();
    try {
      await call(null, { e: slug, t: code, action: 'gotit', ref: id });
      const b = (data.broadcasts || []).find((x) => x.id === id);
      if (b) b.gotIt = true;
      toast('Thanks. The coordinator can see you got it.');
    } catch (_) {
      toast("Didn't go through. Check your signal and tap Got it again.");
    } finally { marking.delete(id); render(); }
  }
  function timeLeft(m, s, now) {
    const left = s.calls[m.id].show + m.dur - now;
    return left >= 0 ? `${Math.ceil(left)} min left` : `${Math.ceil(-left)} min over`;
  }

  async function load() {
    try {
      const d = await call({ e: slug, t: code });
      skew = d.now - Date.now();
      lastOk = Date.now(); savedCopy = false;
      if (d.closed) {
        // Closed out: swap to the thank-you screen and drop the alert sheet and saved check-in.
        closeSheet(); store.del(doneKey); store.set(lastKey, JSON.stringify({ d, at: lastOk }));
        const sig = JSON.stringify([d.closed, d.review]);
        if (data && !data.closed) buzz(80);
        const same = data && data.closed && sig === lastSig && failed === 0;
        data = d; lastSig = sig; failed = 0;
        if (!same) render();
        return;
      }
      const live = d.moments.filter((m) => stateOf(m, d.state) === 'live').sort((a, b) => (d.state.calls[b.id].seq || d.state.calls[b.id].at) - (d.state.calls[a.id].seq || d.state.calls[a.id].at))[0];
      if (data && live && live.id !== lastLive) flash(live.title, (live.vendors || []).includes(d.vendor.id) ? "That's you" : '');
      lastLive = live ? live.id : null;
      if (d.vendor.checkedIn) store.del(doneKey);
      if (data && (d.myAlerts || []).some((a) => a.ack && !(data.myAlerts || []).find((x) => x.id === a.id && x.ack))) { toast(`${d.event.coordinator.name} has seen your alert.`); buzz(80); }
      const msgs = d.broadcasts || [];
      if (seenMsgs) {
        const incoming = msgs.filter((b) => !seenMsgs.has(b.id));
        incoming.forEach((b) => toast(`${b.level === 'urgent' ? '🚨' : b.direct ? '💬' : '📢'} Coordinator: ${b.text}`));
        if (incoming.length) buzz(incoming.some((b) => b.level === 'urgent') ? [300, 120, 300, 120, 300] : [120, 80, 120]);
      }
      seenMsgs = new Set(msgs.map((b) => b.id));
      store.set(lastKey, JSON.stringify({ d, at: lastOk }));
      const sig = JSON.stringify([d.state, d.vendor, d.myAlerts, msgs]);
      const same = data && sig === lastSig && failed === 0;
      data = d; lastSig = sig; failed = 0;
      if (!same) render();
    } catch (e) {
      if (e.status === 404 || e.status === 401) { store.del(lastKey); return gone(); }
      failed++;
      if (!data) {
        // Offline on first open: show the last copy this phone saw, clearly marked.
        let saved = null;
        try { saved = JSON.parse(store.get(lastKey) || 'null'); } catch (_) { saved = null; }
        if (saved && saved.d) { data = saved.d; lastOk = saved.at; savedCopy = true; skew = 0; }
      }
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
      store.set(doneKey, JSON.stringify({ session: r.session, show: r.show }));
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
  let sheetOpener = null, backgroundState = [], sheetFocusTimer = null;
  function openSheet() {
    if (sheet.classList.contains('open')) return;
    sheetOpener = document.activeElement;
    // Make every sibling branch outside the dialog inert, preserving prior state.
    backgroundState = [];
    let branch = sheet;
    while (branch.parentElement && branch.parentElement !== document.documentElement) {
      Array.from(branch.parentElement.children).forEach((node) => {
        if (node === branch || node === scrim || ['SCRIPT','STYLE','LINK'].includes(node.tagName)) return;
        backgroundState.push([node, node.hasAttribute('inert')]); node.setAttribute('inert', '');
      });
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    scrim.classList.add('open'); sheet.classList.add('open'); sheet.removeAttribute('inert');
    sheetFocusTimer = setTimeout(() => { if (sheet.classList.contains('open')) text.focus(); }, 250);
  }
  function closeSheet() {
    if (!scrim || !sheet || !sheet.classList.contains('open')) return;
    clearTimeout(sheetFocusTimer);
    scrim.classList.remove('open'); sheet.classList.remove('open'); sheet.setAttribute('inert', '');
    backgroundState.forEach(([node, wasInert]) => { if (!wasInert) node.removeAttribute('inert'); });
    backgroundState = [];
    if (sheetOpener && sheetOpener.isConnected) sheetOpener.focus();
    else { const fallback = document.getElementById('alert'); if (fallback) fallback.focus(); }
    sheetOpener = null;
  }
  sheet.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !sheet.classList.contains('open')) return;
    const targets = Array.from(sheet.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')).filter((node) => node.getClientRects().length);
    const first = targets[0], last = targets[targets.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
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
      text.value = ''; closeSheet();
      toast(level === 'urgent' ? 'Sent. Not seen yet. If it is an emergency, call now.' : "Sent. You'll see when it's been read.");
      if (refresh) refresh();
    } catch (e) {
      toast("Didn't send. Your message is still there. Try again or call.");
    } finally {
      sending = false; send.textContent = 'Send to coordinator'; send.disabled = !text.value.trim();
    }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  if (!slug || !code) gone(); else refresh = poll(load, 12000);
  setInterval(() => {
    const sv = document.getElementById('syncval');
    if (sv && failed < 2 && !savedCopy) sv.textContent = 'Updated ' + ago(lastOk);
  }, 5000);
  setInterval(() => { if (!document.querySelector('.sheet.open')) render(); }, 60000);
})();
