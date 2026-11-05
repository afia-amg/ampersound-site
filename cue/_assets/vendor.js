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
  const doneKey = `cue:${slug}:${code}:checkin`, lastKey = `cue:${slug}:${code}:last`, outKey = `cue:${slug}:${code}:outbox`;

  // Outbox: with no signal, check-ins, Got it and messages wait on the phone and send themselves
  // when signal comes back. Each carries a client id, so a resend never posts twice.
  const cid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const outbox = () => { try { const a = JSON.parse(store.get(outKey) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const saveOut = (a) => (a.length ? store.set(outKey, JSON.stringify(a.slice(-30))) : store.del(outKey));
  const offline = () => failed >= 2 || savedCopy || navigator.onLine === false;
  let flushing = false;
  async function sendOrQueue(body, label) {
    const item = { ...body, cid: cid(), queuedAt: Date.now(), label };
    if (!offline()) {
      try { return { sent: true, r: await call(null, { e: slug, t: code, ...item }) }; }
      catch (e) { if (e.status && e.status !== 503) throw e; } // a real refusal, not a lost connection
    }
    saveOut(outbox().concat(item));
    return { sent: false };
  }
  async function flush() {
    if (flushing || !navigator.onLine) return;
    const q = outbox();
    if (!q.length) return;
    flushing = true;
    let sent = 0;
    try {
      for (const item of q) {
        try { await call(null, { e: slug, t: code, ...item }); sent++; }
        catch (e) {
          if (!e.status || e.status === 503) break; // still no signal: keep the rest for later
          sent++; // refused for good (show closed, message gone): drop it
        }
      }
    } finally {
      saveOut(outbox().slice(sent)); flushing = false;
      if (sent) { toast(`Back online. ${sent} waiting update${sent === 1 ? '' : 's'} sent.`); buzz(80); if (refresh) refresh(); }
      render();
    }
  }
  window.addEventListener('online', flush);

  const nameOf = (id) => ((data && data.team) || []).find((x) => x.id === id)?.name || 'a vendor';
  function localCheckin(session) {
    try { const c = JSON.parse(store.get(doneKey) || 'null'); return c && c.session === session ? c : null; } catch (_) { return null; }
  }
  // The event team: whatever each vendor agreed to share. Tap to call, text, email, or message them here.
  function teamHTML(list, canMessage) {
    if (!list || !list.length) return '';
    return `<ul class="team">${list.map((x) => {
      const c = x.card || {};
      const acts = [
        c.phone ? `<a class="chip" href="tel:${esc(c.phone)}" aria-label="Call ${esc(x.name)}">📞 Call</a>` : '',
        c.phone ? `<a class="chip" href="sms:${esc(c.phone)}" aria-label="Text ${esc(x.name)}">💬 Text</a>` : '',
        c.email ? `<a class="chip" href="mailto:${esc(c.email)}" aria-label="Email ${esc(x.name)}">✉️ Email</a>` : '',
        c.instagram ? `<a class="chip" href="https://instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener" aria-label="${esc(x.name)} on Instagram">@${esc(c.instagram)}</a>` : '',
        c.website ? `<a class="chip" href="${esc(c.website)}" target="_blank" rel="noopener" aria-label="${esc(x.name)} website">🌐 Site</a>` : '',
        canMessage ? `<button class="chip" type="button" data-msg="${esc(x.id)}" aria-label="Message ${esc(x.name)} here">✍️ Message</button>` : '',
      ].join('');
      return `<li><div class="who"><b>${esc(x.name)}</b><small>${esc(x.role)}${c.person ? ' · ' + esc(c.person) : ''}${c.phoneLabel ? ' · ' + esc(c.phoneLabel) : ''}</small></div>${acts ? `<div class="acts">${acts}</div>` : ''}${!x.card ? '<small class="meta">Contact details not shared</small>' : ''}</li>`;
    }).join('')}</ul>`;
  }
  const musicHTML = (m) => (m && m.music && m.music.length ? `<div class="music">${m.music.map((x) => `<div>🎵 <span>${esc(x.label)}:</span> <b>${esc(x.song)}</b></div>`).join('')}</div>` : '');
  function playlistHTML(pl) {
    if (!pl) return '';
    const lists = [['Must play', pl.mustPlay], ['Do not play', pl.dontPlay]].filter(([, a]) => a && a.length);
    return `<section class="card playlist"><div class="kicker live">🎧 The couple's music</div>
      ${pl.url ? `<a class="btn ghost" href="${esc(pl.url)}" target="_blank" rel="noopener" style="margin-top:0.6rem">Open their playlist</a>` : ''}
      ${pl.vibe ? `<p class="note">Vibe: ${esc(pl.vibe)}</p>` : ''}
      ${lists.map(([t, a]) => `<details><summary>${t} · ${a.length}</summary><ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}
      ${pl.notes ? `<p class="note">${esc(pl.notes)}</p>` : ''}</section>`;
  }
  // After close out: a thank-you, the Google review link, and the team so everyone can keep in touch.
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
        ${data.team && data.team.length ? `<div class="label" style="margin-top:1rem">Keep in touch with the team</div>${teamHTML(data.team, false)}` : ''}
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
    const mine = ordered.filter((m) => (m.vendors || []).includes(v.id) || (m.music && m.music.length));
    const myLive = mine.find((m) => stateOf(m, s) === 'live');
    const myNext = mine.find((m) => stateOf(m, s) === 'pending');
    const hero = myLive || myNext;
    // Running late or early: shift pending times by the drift of that moment's stage.
    const drift = (m) => Math.round(lane(moments, s, m.lane || null).drift);
    const when = (m) => { const d = stateOf(m, s) === 'pending' ? drift(m) : 0; return d ? `~${fmt(m.time + d)} <s>${fmt(m.time)}</s>` : fmt(m.time); };
    const lateBy = hero ? drift(hero) : 0;
    const multiRoom = (ev.lanes || []).length > 1;
    const local = localCheckin(s.session);
    const checked = v.checkedIn || (local ? { show: Number(local.show) } : null);
    const stale = failed >= 2 || savedCopy;
    const queued = outbox(), queuedCheckin = queued.find((x) => x.action === 'checkin');
    const alerts = data.myAlerts || [];
    const msgs = data.broadcasts || [], fresh = msgs.filter((b) => !b.gotIt), read = msgs.filter((b) => b.gotIt);
    const waiting = alerts.filter((a) => a.level === 'urgent' && !a.ack && !a.resolved && Date.now() + skew - a.at > URGENT_WAIT);

    app.innerHTML = `
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(ev.name)}</b><span>${esc(ev.dateLabel)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i><span id="syncval">${stale ? 'Offline' : 'Updated ' + ago(lastOk)}</span></div>
      </header>
      ${stale ? `<div class="banner" role="alert">${savedCopy ? 'No signal. This is your saved copy' : 'No signal since ' + esc(at(lastOk, ev.tz))}. Your whole day is saved on this phone, and anything you tap waits here and sends when signal is back. Times may be out of date. If anything feels off, call ${esc(ev.coordinator.name)}.</div>` : ''}
      ${queued.length ? `<div class="banner ok" role="status">⏳ ${queued.length} waiting to send: ${esc(queued.map((x) => x.label).join(', '))}. Keep this page open, it sends on its own.</div>` : ''}
      ${waiting.length ? `<div class="banner" role="alert">🚨 ${esc(ev.coordinator.name)} hasn't seen your urgent alert yet. ${ev.coordinator.phone ? `<a href="tel:${esc(ev.coordinator.phone)}"><b>Call now</b></a>` : '<b>Find them in person now.</b>'}</div>` : ''}
      ${fresh.map((b) => `<section class="card msg ${b.level === 'urgent' ? 'urgent' : ''}" role="alert">
        <div class="kicker">${b.level === 'urgent' ? '🚨 Urgent' : b.direct ? '💬 Just for you' : '📢 To everyone'}${b.level === 'urgent' && b.direct ? ' · Just for you' : ''} · ${b.from ? 'From ' + esc(b.by) : 'Coordinator'} · ${fmt(b.show)}</div>
        <div class="msg-text">${esc(b.text)}</div>
        <div class="${b.from ? 'row2' : ''}"><button class="btn" type="button" data-gotit="${esc(b.id)}" ${marking.has(b.id) ? 'disabled' : ''}>${marking.has(b.id) ? 'Sending…' : 'Got it'}</button>${b.from ? `<button class="btn ghost" type="button" data-msg="${esc(b.from)}">Reply</button>` : ''}</div>
      </section>`).join('')}
      <h1 class="hi">Hi, ${esc(v.name)}</h1>
      ${checked
        ? `<div class="here">✓ Checked in${checked.show != null && !Number.isNaN(checked.show) ? ' at ' + fmt(checked.show) : ''}</div>`
        : queuedCheckin ? `<div class="here">⏳ Checked in at ${esc(queuedCheckin.shown || '')}, waiting for signal to send</div>`
        : `<section class="card">
            <div class="arrive">📍 <span>Arrive by <b>${v.arrival != null ? fmt(v.arrival) : 'your first call'}</b> · ${esc(ev.venue)}</span></div>
            <button class="btn" id="checkin" type="button">I'm here, check me in</button>
            ${stale ? '<p class="meta" style="margin-top:0.5rem">No signal right now. Tap anyway: it saves on this phone and sends when signal is back.</p>' : ''}
          </section>`}
      <section class="card">
        <div class="kicker ${myLive ? 'live' : ''}">${myLive ? "You're on now" : hero ? 'Your next moment' : "You're all done"}</div>
        <div class="big">${esc(hero ? hero.title : 'Thank you!')}</div>
        ${hero ? `<div class="meta">${when(hero)}${multiRoom && hero.lane ? ' · ' + esc(hero.lane) : ''}${hero.location && hero.location !== hero.lane ? ' · ' + esc(hero.location) : ''}${myLive && now != null ? ' · ' + timeLeft(myLive, s, now) : ''}</div>` : ''}
        ${hero && !myLive && hero.call != null ? `<div class="note">📣 Your call time: <b>${fmt(hero.call + (stateOf(hero, s) === 'pending' ? drift(hero) : 0))}</b>${drift(hero) ? ' (adjusted)' : ''}</div>` : ''}
        ${hero && !myLive && lateBy ? `<div class="note">${lateBy > 0 ? `Running about ${lateBy} min behind.` : `Running about ${-lateBy} min ahead.`} Times below are adjusted.</div>` : ''}
        ${hero && hero.notes ? `<div class="note">${esc(hero.notes)}</div>` : ''}
        ${musicHTML(hero)}
      </section>
      <div class="nowline"><i class="dot ${live ? 'live' : ''}"></i><span>At the event now:</span><b>${esc(live ? live.title : 'Starting soon')}</b></div>
      <div class="label">Your day</div>
      <ol class="list">
        ${mine.map((m) => { const st = stateOf(m, s); return `<li class="${st === 'live' ? 'now' : st === 'done' ? 'done' : ''}"><span class="t">${when(m)}</span><span class="x">${esc(m.title)}<small>${esc([multiRoom ? m.lane : '', m.location && m.location !== m.lane ? m.location : '', m.call != null && st === 'pending' ? 'Call ' + fmt(m.call + drift(m)) : ''].filter(Boolean).join(' · '))}</small>${musicHTML(m)}</span>${st === 'done' ? '✓' : ''}</li>`; }).join('')}
      </ol>
      ${alerts.length ? `<div class="label">Your alerts</div><ul class="alerts">${alerts.map((a) => `<li><i class="dot ${a.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(a.text)}</div><small>${fmt(a.show)} · <span class="st ${a.resolved ? 'ok' : a.ack ? '' : 'new'}">${a.resolved ? 'Resolved' : a.ack ? 'Seen by ' + esc(ev.coordinator.name) : 'Not seen yet'}</span></small></div></li>`).join('')}</ul>` : ''}
      ${read.length ? `<div class="label">Messages from the coordinator</div><ul class="alerts">${read.map((b) => `<li><i class="dot ${b.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(b.text)}</div><small>${b.from ? 'From ' + esc(b.by) + ' · ' : ''}${b.direct ? 'Just for you · ' : ''}${fmt(b.show)} · <span class="st ok">✓ Got it</span></small></div></li>`).join('')}</ul>` : ''}
      ${(data.sent || []).length ? `<div class="label">Messages you sent</div><ul class="alerts">${data.sent.map((b) => `<li><i class="dot"></i><div class="x"><div>${esc(b.text)}</div><small>To ${esc(b.to ? nameOf(b.to) : 'everyone')} · ${fmt(b.show)} · <span class="st ${b.gotIt ? 'ok' : ''}">${b.to ? (b.gotIt ? '✓ Got it' : 'Not seen yet') : b.gotIt + ' got it'}</span></small></div></li>`).join('')}</ul>` : ''}
      ${data.music ? playlistHTML(data.playlist) : ''}
      <div class="${ev.coordinator.phone ? 'row2' : ''}" style="margin-top:1rem">
        <button class="btn ghost" id="alert" type="button">💬 Send a message</button>
        ${ev.coordinator.phone ? `<a class="btn ghost" href="tel:${esc(ev.coordinator.phone)}">📞 Call ${esc(ev.coordinator.name)}</a>` : ''}
      </div>
      ${data.team && data.team.length ? `<div class="label" style="margin-top:1.25rem">Event team</div>${teamHTML(data.team, true)}` : ''}
      <p class="foot">No account needed. Urgent? Message ${esc(ev.coordinator.name)}${ev.coordinator.phone ? ' and call' : ''}.<br>Point of contact: ${esc(ev.coordinator.name)}${ev.coordinator.phoneLabel ? ' · ' + esc(ev.coordinator.phoneLabel) : ''}<br>Messages between vendors are visible to ${esc(ev.coordinator.name)}.</p>`;

    const ci = document.getElementById('checkin');
    if (ci) ci.onclick = checkIn;
    document.getElementById('alert').onclick = () => openSheet('coordinator');
    app.querySelectorAll('[data-msg]').forEach((b) => (b.onclick = () => openSheet(b.dataset.msg)));
    app.querySelectorAll('[data-gotit]').forEach((b) => (b.onclick = () => gotIt(b.dataset.gotit)));
  }
  async function gotIt(id) {
    if (marking.has(id)) return;
    marking.add(id); render();
    try {
      const b = (data.broadcasts || []).find((x) => x.id === id);
      const { sent } = await sendOrQueue({ action: 'gotit', ref: id }, 'Got it');
      if (b) b.gotIt = true;
      toast(sent ? 'Thanks. The coordinator can see you got it.' : 'Saved. It sends when you have signal.');
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
      const sig = JSON.stringify([d.state, d.vendor, d.myAlerts, msgs, d.sent, d.team, d.playlist, d.moments]);
      const same = data && sig === lastSig && failed === 0;
      data = d; lastSig = sig; failed = 0;
      if (!same) render();
      if (outbox().length) setTimeout(flush, 0);
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
      const tappedAt = Date.now();
      const show = data ? showNow(data.state, data.event.tz, skew) : null;
      const { sent, r } = await sendOrQueue({ action: 'checkin', tappedAt, shown: show != null ? fmt(show) : at(tappedAt, data && data.event.tz) }, 'Check-in');
      if (sent) { store.set(doneKey, JSON.stringify({ session: r.session, show: r.show })); toast("You're checked in. The coordinator can see it."); }
      else toast('No signal. Your check-in is saved with the time you tapped, and sends on its own.');
      render();
    } catch (e) {
      b.disabled = false; b.textContent = "I'm here, check me in";
      toast("Didn't go through. Check your signal and try again.");
    }
  }

  // Alert sheet
  const scrim = document.querySelector('.scrim'), sheet = document.querySelector('.sheet');
  const text = sheet.querySelector('textarea'), send = sheet.querySelector('#send');
  const toSel = sheet.querySelector('#msgTo'), seg = sheet.querySelector('.seg'), note = sheet.querySelector('#msgNote');
  let target = 'coordinator';
  function targetName() { return target === 'coordinator' ? (data ? data.event.coordinator.name : 'the coordinator') : target === 'all' ? 'everyone' : nameOf(target); }
  function syncSheet() {
    const coordinator = target === 'coordinator';
    seg.hidden = !coordinator;
    if (!coordinator) { level = 'note'; sheet.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === 'note'))); }
    note.textContent = coordinator ? 'Urgent pings them right away. If it is an emergency, also call.' : `${target === 'all' ? 'Every vendor' : nameOf(target)} sees it on their page. ${data ? data.event.coordinator.name : 'The coordinator'} can see it too.`;
    if (!sending) send.textContent = 'Send to ' + targetName();
  }
  toSel.onchange = () => { target = toSel.value; syncSheet(); };
  let sheetOpener = null, backgroundState = [], sheetFocusTimer = null;
  function openSheet(to) {
    if (sheet.classList.contains('open')) return;
    if (!data || data.closed) return;
    const team = data.team || [];
    toSel.innerHTML = `<option value="coordinator">${esc(data.event.coordinator.name)} (point of contact)</option><option value="all">Everyone on the team</option>`
      + team.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.role)}</option>`).join('');
    target = to && (to === 'all' || to === 'coordinator' || team.some((x) => x.id === to)) ? to : 'coordinator';
    toSel.value = target; syncSheet();
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
    sheetFocusTimer = setTimeout(() => { if (sheet.classList.contains('open')) (to ? text : toSel).focus(); }, 250);
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
    const targets = Array.from(sheet.querySelectorAll('button:not(:disabled),select:not(:disabled),textarea:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')).filter((node) => node.getClientRects().length);
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
    const who = targetName(), toCoordinator = target === 'coordinator';
    try {
      const { sent } = await sendOrQueue(toCoordinator ? { action: 'alert', text: msg, level } : { action: 'message', to: target, text: msg }, 'Message to ' + who);
      text.value = ''; closeSheet();
      if (!sent) toast(level === 'urgent' ? 'No signal: saved, sends on its own. If it is an emergency, call or find them now.' : 'No signal. Saved, it sends when you have signal.');
      else toast(toCoordinator ? (level === 'urgent' ? 'Sent. Not seen yet. If it is an emergency, call now.' : "Sent. You'll see when it's been read.") : `Sent to ${who}.`);
      if (refresh) refresh();
    } catch (e) {
      toast(e.status === 429 ? e.message : "Didn't send. Your message is still there. Try again or call.");
    } finally {
      sending = false; send.disabled = !text.value.trim(); syncSheet();
    }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  if (!slug || !code) gone(); else refresh = poll(load, 12000);
  // Keep this page itself on the phone, so the link opens with no signal at all.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    try { navigator.serviceWorker.register('/cue/sw.js', { scope: '/cue/' }).catch(() => {}); } catch (_) { /* unsupported */ }
  }
  setInterval(() => {
    const sv = document.getElementById('syncval');
    if (sv && failed < 2 && !savedCopy) sv.textContent = 'Updated ' + ago(lastOk);
  }, 5000);
  setInterval(() => { if (!document.querySelector('.sheet.open')) render(); }, 60000);
})();
