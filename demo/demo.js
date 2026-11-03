/* Ampersound interactive demo: one sample wedding, start to finish.
   Pure front end. No fetch, no storage, no ClickUp, no Stripe: nothing leaves the browser. */
(function (root) {
  'use strict';
  const t = (h, m) => h * 60 + m;
  const EVENT = { couple: 'Ava & Marcus', dateLabel: 'Sat, Jun 12, 2027', venue: 'Red Butte Garden, SLC', coordinator: 'Afia' };
  const VENDORS = [
    { id: 'amg', name: 'Ampersound Media Group', role: 'DJ + MC', arrival: t(15, 30) },
    { id: 'photo', name: 'Lumen & Lace Photo', role: 'Photography', arrival: t(13, 30) },
    { id: 'video', name: 'Fieldnote Films', role: 'Videography', arrival: t(14, 0) },
    { id: 'florals', name: 'Wild Sage Florals', role: 'Florals', arrival: t(13, 0) },
    { id: 'catering', name: 'Copper Table Catering', role: 'Catering', arrival: t(15, 0) },
    { id: 'hmua', name: 'Glow Studio', role: 'Hair + makeup', arrival: t(10, 30) },
    { id: 'venue', name: 'Red Butte Events', role: 'Venue lead', arrival: t(12, 0) },
    { id: 'officiant', name: 'Rev. Dana Ellis', role: 'Officiant', arrival: t(16, 15) },
  ];
  const MOMENTS = [
    { id: 'm01', time: t(14, 0), title: 'Hair + makeup final touches', location: 'Bridal suite', vendors: ['hmua', 'photo'] },
    { id: 'm02', time: t(15, 30), title: 'First look + portraits', location: 'Garden terrace', vendors: ['photo', 'video'] },
    { id: 'm03', time: t(16, 0), title: 'Ceremony flip + florals', location: 'Ceremony lawn', vendors: ['florals', 'venue'] },
    { id: 'm04', time: t(16, 30), title: 'Guest arrival, prelude music', location: 'Ceremony lawn', vendors: ['amg', 'venue'] },
    { id: 'm05', time: t(17, 0), title: 'Ceremony', location: 'Ceremony lawn', vendors: ['officiant', 'amg', 'photo', 'video'] },
    { id: 'm06', time: t(17, 30), title: 'Cocktail hour', location: 'Terrace', vendors: ['catering', 'amg', 'photo'] },
    { id: 'm07', time: t(18, 30), title: 'Grand entrance', location: 'Ballroom', vendors: ['amg', 'photo', 'video'] },
    { id: 'm08', time: t(18, 45), title: 'First dance', location: 'Ballroom', vendors: ['amg', 'photo', 'video'] },
    { id: 'm09', time: t(18, 55), title: 'Dinner service', location: 'Ballroom', vendors: ['catering', 'amg'] },
    { id: 'm10', time: t(19, 40), title: 'Toasts', location: 'Ballroom', vendors: ['amg', 'video'] },
    { id: 'm11', time: t(20, 0), title: 'Cake cutting', location: 'Ballroom', vendors: ['catering', 'photo'] },
    { id: 'm12', time: t(20, 10), title: 'Open dancing', location: 'Ballroom', vendors: ['amg', 'photo'] },
    { id: 'm13', time: t(22, 0), title: 'Sparkler exit', location: 'Front drive', vendors: ['venue', 'photo', 'video'] },
    { id: 'm14', time: t(22, 10), title: 'Load out', location: 'Ballroom', vendors: ['amg', 'florals', 'catering', 'venue'] },
  ];
  const PLAN_MOMENTS = ['m05', 'm06', 'm07', 'm08', 'm10', 'm13'];
  const MILESTONES = [
    { days: 9999, title: 'Portal opens', detail: 'Music, timeline, and details start in one place.' },
    { days: 14, title: 'Timeline approved and locked', detail: 'Your balance is due the same day.' },
    { days: 10, title: 'Vendors loaded', detail: 'Every vendor, arrival time, and phone number.' },
    { days: 7, title: 'Vendor links sent', detail: 'Each vendor gets a private live link and opens it.' },
    { days: 1, title: 'Packed and printed', detail: 'Gear packed. Run sheet printed, 2 copies.' },
    { days: 0, title: 'Wedding day', detail: 'Signal tested at the venue before the first cue.' },
  ];

  function fmt(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60);
    return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const vendor = (id) => VENDORS.find((v) => v.id === id);

  function fresh() {
    return {
      signed: null, paid: false, planned: false, daysOut: 120, approved: false,
      must: ['September · Earth, Wind & Fire', 'Golden Hour · JVKE', 'Before I Let Go · Frankie Beverly & Maze'],
      dont: ['Macarena · Los Del Rio'],
      cur: -1, checkins: {}, alerts: [], broadcasts: [], closed: false, viewAs: 'photo', seq: 0,
    };
  }

  // Milestones done once the countdown reaches them; the first one not reached is "next".
  function milestones(daysOut) {
    let nextSet = false;
    return MILESTONES.map((m) => {
      let state = daysOut <= m.days ? 'done' : 'later';
      if (state === 'later' && !nextSet) { state = 'next'; nextSet = true; }
      return { ...m, state };
    });
  }
  function momentState(s, i) { return i < s.cur ? 'done' : i === s.cur ? 'live' : 'pending'; }

  // What one vendor's phone shows: only their moments, plus what's happening now.
  function vendorView(s, id) {
    const mine = [];
    MOMENTS.forEach((m, i) => { if (m.vendors.includes(id)) mine.push({ ...m, state: momentState(s, i) }); });
    const live = s.cur >= 0 ? MOMENTS[s.cur] : null;
    const hero = mine.find((m) => m.state === 'live') || mine.find((m) => m.state === 'pending') || null;
    return {
      vendor: vendor(id), mine, live, hero, onNow: !!(hero && hero.state === 'live'),
      checkedIn: !!s.checkins[id],
      messages: s.broadcasts.map((b) => ({ ...b, gotIt: b.gotIt.includes(id) })),
      alerts: s.alerts.filter((a) => a.vendor === id),
    };
  }
  function closeOutCheck(s) {
    const open = s.alerts.filter((a) => !a.resolved).length;
    if (open) return { ok: false, reason: `Resolve ${open === 1 ? 'the open alert' : 'all ' + open + ' open alerts'} first. We never close a show with a question hanging.` };
    return { ok: true, reason: '' };
  }
  function go(s) { if (s.closed || s.cur >= MOMENTS.length - 1) return false; s.cur += 1; return true; }
  function undo(s) { if (s.closed || s.cur < 0) return false; s.cur -= 1; return true; }
  function addSong(s, list, raw) {
    const name = String(raw || '').trim().slice(0, 80);
    if (!name) return 'Type a song first.';
    if (s.must.concat(s.dont).some((x) => x.toLowerCase() === name.toLowerCase())) return 'That one is already on a list.';
    (list === 'dont' ? s.dont : s.must).push(name);
    return '';
  }

  const api = { EVENT, VENDORS, MOMENTS, MILESTONES, fresh, milestones, vendorView, closeOutCheck, go, undo, addSong, fmt, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AMGDemo = api;
  if (typeof document === 'undefined') return;

  /* ---------- Page ---------- */
  const $ = (id) => document.getElementById(id);
  const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let s = fresh(), timers = [], toastTimer = null;
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  // Re-render without losing keyboard focus: elements carry data-key, focus follows the key.
  function keepFocus(fn, fallback) {
    const a = document.activeElement, key = a && a.dataset ? a.dataset.key : null;
    fn();
    if (!key) return;
    const again = document.querySelector(`[data-key="${key}"]`);
    if (again && !again.disabled) again.focus();
    else if (fallback && $(fallback)) $(fallback).focus();
  }

  /* Tabs */
  const tabs = Array.from(document.querySelectorAll('[role=tab]'));
  function select(name, focusPanel) {
    if (name === 'plan') s.planned = true;
    tabs.forEach((tab) => {
      const on = tab.id === 'tab-' + name;
      tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !on;
    });
    if (focusPanel) { const p = $('ch-' + name); p.focus({ preventScroll: true }); p.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
    renderAll();
  }
  tabs.forEach((tab, i) => {
    tab.onclick = () => select(tab.id.slice(4));
    tab.onkeydown = (e) => {
      const k = e.key; let j = null;
      if (k === 'ArrowRight') j = (i + 1) % tabs.length; else if (k === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (k === 'Home') j = 0; else if (k === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault(); tabs[j].focus(); select(tabs[j].id.slice(4));
    };
  });
  document.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => select(b.dataset.goto, true)));

  /* 1. Book */
  function renderBook() {
    const done = 1 + (s.signed ? 1 : 0) + (s.paid ? 1 : 0) + (s.planned ? 1 : 0);
    $('bookCount').textContent = `${done} of 4 done`;
    $('bookBar').style.width = (done / 4) * 100 + '%';
    $('stepSign').classList.toggle('done', !!s.signed);
    $('signForm').hidden = !!s.signed;
    $('signDone').hidden = !s.signed;
    if (s.signed) $('signDone').textContent = `Signed by ${s.signed} · just now`;
    $('stepPay').classList.toggle('done', s.paid);
    $('payBtn').disabled = !s.signed || s.paid;
    $('payBtn').hidden = s.paid;
    $('payHint').hidden = s.paid;
    $('payHint').textContent = s.signed ? 'Real payments run through our secure Stripe checkout.' : 'Sign first. Real payments run through our secure Stripe checkout.';
    $('payDone').hidden = !s.paid;
    $('stepPlan').classList.toggle('done', s.planned);
  }
  $('signBtn').onclick = () => {
    const name = $('signName').value.trim();
    if (!name || !$('signConsent').checked) { $('signErr').textContent = 'Type your name and check the box to sign.'; return; }
    $('signErr').textContent = ''; s.signed = name.slice(0, 60); renderBook();
    $('payBtn').focus(); toast('Signed. In a real portal, this saves to your file right away.');
  };
  $('signName').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('signBtn').click(); } };
  $('payBtn').onclick = () => { s.paid = true; renderBook(); $('payDone').tabIndex = -1; $('payDone').focus(); toast('Deposit marked paid. Demo only, no charge.'); };

  /* 2. Plan */
  function renderPlan() {
    $('daysLabel').textContent = s.daysOut === 0 ? "It's the wedding day" : `${s.daysOut} day${s.daysOut === 1 ? '' : 's'} to go`;
    $('milestones').innerHTML = milestones(s.daysOut).map((m) => `<li class="${m.state}">
      <span class="when">${m.days >= 9999 ? 'Booked' : m.days === 0 ? 'Day of' : m.days === 1 ? '1 day out' : m.days + ' days out'}</span>
      <span class="x"><b>${esc(m.title)}</b><small>${esc(m.detail)}</small></span>
      <span class="st">${m.state === 'done' ? '✓ Done' : m.state === 'next' ? 'Up next' : ''}</span></li>`).join('');
    const chips = (list, key) => list.map((x, i) => `<li><span>${esc(x)}</span><button type="button" data-key="rm-${key}-${i}" data-rm="${key}" data-i="${i}" aria-label="Remove ${esc(x)}">×</button></li>`).join('');
    $('mustList').innerHTML = chips(s.must, 'must') || '<li class="empty">Nothing yet</li>';
    $('dontList').innerHTML = chips(s.dont, 'dont') || '<li class="empty">Nothing yet</li>';
    $('planTimeline').innerHTML = PLAN_MOMENTS.map((id) => MOMENTS.find((m) => m.id === id))
      .map((m) => `<li><span class="t">${fmt(m.time)}</span><span class="x">${esc(m.title)}<small>${esc(m.location)}</small></span>${s.approved ? '<span aria-label="locked">🔒</span>' : ''}</li>`).join('');
    $('approveBtn').hidden = s.approved;
    $('approveDone').hidden = !s.approved;
  }
  $('days').oninput = (e) => { s.daysOut = Number(e.target.value); renderPlan(); };
  function songAdd() {
    const err = addSong(s, $('songList').value, $('song').value);
    $('songErr').textContent = err;
    if (!err) { $('song').value = ''; renderPlan(); toast('Added. Your DJ sees this list live.'); }
    $('song').focus();
  }
  $('songAdd').onclick = songAdd;
  $('song').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); songAdd(); } };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    const list = b.dataset.rm === 'dont' ? s.dont : s.must, gone = list.splice(Number(b.dataset.i), 1)[0];
    renderPlan(); $('song').focus(); toast(`Removed ${gone}.`);
  });
  $('approveBtn').onclick = () => { s.approved = true; renderPlan(); $('approveDone').tabIndex = -1; $('approveDone').focus(); };

  /* 3. Show day */
  function renderConsole() {
    const live = s.cur >= 0 ? MOMENTS[s.cur] : null, next = MOMENTS[s.cur + 1] || null;
    $('consoleNow').innerHTML = `<div class="now"><p class="kicker live">Now</p><p class="big-sm">${live ? esc(live.title) : 'Starting soon'}</p>
      <p class="meta">${live ? fmt(live.time) + ' · ' + esc(live.location) : 'Tap GO to call the first moment.'}</p></div>`;
    const go = $('goBtn');
    go.innerHTML = s.closed ? 'Show closed out' : next ? `GO <small>${esc(next.title)}</small>` : 'Last moment called';
    go.disabled = s.closed || !next;
    $('undoBtn').disabled = s.closed || s.cur < 0;
    const here = VENDORS.filter((v) => s.checkins[v.id]).length;
    $('hereCount').textContent = `${here} of ${VENDORS.length} checked in`;
    $('vendorGrid').innerHTML = VENDORS.map((v) => `<li class="${s.checkins[v.id] ? 'in' : ''}"><i class="dot ${s.checkins[v.id] ? 'live' : ''}"></i><span><b>${esc(v.name)}</b><small>${esc(v.role)} · ${s.checkins[v.id] ? 'Here' : 'Arrive ' + fmt(v.arrival)}</small></span></li>`).join('');
    $('arrivals').disabled = here === VENDORS.length || s.closed;
    $('consoleAlerts').innerHTML = s.alerts.length ? s.alerts.slice().reverse().map((a) => `<li class="${a.resolved ? 'resolved' : ''}">
      <div><b>${esc(vendor(a.vendor).name)}</b> ${esc(a.text)}<small>${a.resolved ? 'Resolved' : a.seen ? 'Seen' : 'New'}</small></div>
      ${a.resolved ? '' : `<span class="acts">${a.seen ? '' : `<button type="button" class="btn ghost xs" data-key="seen-${a.id}" data-alert="seen" data-id="${a.id}">Seen</button>`}<button type="button" class="btn ghost xs" data-key="res-${a.id}" data-alert="resolve" data-id="${a.id}">Resolve</button></span>`}</li>`).join('')
      : '<li class="empty">No alerts. Send one from the vendor phone.</li>';
    $('consoleBroadcasts').innerHTML = s.broadcasts.slice().reverse().map((b) => `<li><div>📢 ${esc(b.text)}<small>Got it: ${b.gotIt.length} of ${VENDORS.length}</small></div></li>`).join('');
    $('bcSend').disabled = s.closed;
  }
  function phoneHTML(id, where) {
    const v = vendorView(s, id), me = v.vendor;
    const head = `<header class="ph-top"><img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt=""><div><b>${esc(EVENT.couple)}</b><span>${esc(EVENT.dateLabel)}</span></div>${s.closed ? '<span class="sync"><i class="dot"></i>Wrapped</span>' : '<span class="sync"><i class="dot live"></i>Live</span>'}</header>`;
    if (s.closed) return head + `<section class="thanks"><p class="kicker live">${esc(EVENT.couple)}</p><p class="big">That's a wrap.</p>
      <p>Thank you, ${esc(me.name)}. Working beside you is what made the day run.</p>
      <p class="meta">If we earned it, a Google review helps a small team more than almost anything.</p>
      <button type="button" class="btn" data-key="${where}-review" data-review>⭐ Leave us a Google review</button>
      <p class="meta">From Afia &amp; Adam · Ampersound Media Group</p></section>`;
    const msgs = v.messages.filter((b) => !b.gotIt).map((b) => `<section class="ph-card msg"><p class="kicker">📢 To everyone · Coordinator</p><p>${esc(b.text)}</p>
      <button type="button" class="btn sm" data-key="${where}-got-${b.id}" data-got="${b.id}">Got it</button></section>`).join('');
    const checkin = v.checkedIn ? '<p class="here">✓ Checked in</p>'
      : `<section class="ph-card"><p class="arrive">📍 Arrive by <b>${fmt(me.arrival)}</b> · ${esc(EVENT.venue)}</p><button type="button" class="btn" data-key="${where}-checkin" data-checkin>I'm here, check me in</button></section>`;
    const hero = `<section class="ph-card"><p class="kicker ${v.onNow ? 'live' : ''}">${v.onNow ? "You're on now" : v.hero ? 'Your next moment' : "You're all done"}</p>
      <p class="big">${esc(v.hero ? v.hero.title : 'Thank you!')}</p>${v.hero ? `<p class="meta">${fmt(v.hero.time)} · ${esc(v.hero.location)}</p>` : ''}</section>`;
    const nowline = `<p class="nowline"><i class="dot ${v.live ? 'live' : ''}"></i><span>At the event now:</span> <b>${esc(v.live ? v.live.title : 'Starting soon')}</b></p>`;
    const list = `<p class="label">Your day</p><ol class="list">${v.mine.map((m) => `<li class="${m.state === 'live' ? 'now' : m.state}"><span class="t">${fmt(m.time)}</span><span class="x">${esc(m.title)}<small>${esc(m.location)}</small></span>${m.state === 'done' ? '✓' : ''}</li>`).join('')}</ol>`;
    const alerts = v.alerts.length ? `<p class="label">Your alerts</p><ul class="ph-alerts">${v.alerts.slice().reverse().map((a) => `<li>${esc(a.text)}<small>${a.resolved ? 'Resolved' : a.seen ? 'Seen by Afia' : 'Not seen yet'}</small></li>`).join('')}</ul>` : '';
    return head + msgs + `<p class="hi">Hi, ${esc(me.name)}</p>` + checkin + hero + nowline + list + alerts;
  }
  function renderPhones() {
    $('phoneShow').innerHTML = phoneHTML(s.viewAs, 'show');
    $('phoneAlertWrap').hidden = s.closed;
    $('phoneWrap').innerHTML = phoneHTML(s.viewAs, 'wrap');
    $('wrapPhoneLabel').textContent = `${vendor(s.viewAs).name}'s phone`;
  }
  function flashPhone(m) {
    if (!m.vendors.includes(s.viewAs)) return;
    const el = document.createElement('div');
    el.className = 'flash'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<p class="kicker live">That's you</p><p class="big">${esc(m.title)}</p>`;
    $('phoneShow').appendChild(el);
    setTimeout(() => el.remove(), reduce ? 900 : 1700);
  }
  $('goBtn').onclick = () => {
    if (!go(s)) return;
    const m = MOMENTS[s.cur], v = vendor(s.viewAs);
    renderShow(); flashPhone(m);
    toast(`GO: ${m.title}. ${m.vendors.includes(s.viewAs) ? v.name + "'s phone says they're on." : 'Every phone updated.'}`);
  };
  $('undoBtn').onclick = () => { if (undo(s)) { keepFocus(renderShow, 'goBtn'); toast('Undone. Phones roll back too.'); } };
  $('arrivals').onclick = () => {
    const waiting = VENDORS.filter((v) => !s.checkins[v.id] && v.id !== s.viewAs);
    if (!waiting.length) { toast('Everyone else is already here.'); return; }
    waiting.forEach((v, i) => later(() => { if (!s.closed) { s.checkins[v.id] = true; keepFocus(renderShow); } }, 450 * (i + 1)));
    toast('Vendors are arriving. Watch the console.');
  };
  $('bcSend').onclick = () => {
    const text = $('bcText').value.trim().slice(0, 200);
    if (!text) { toast('Write a message first.'); return; }
    const b = { id: 'b' + ++s.seq, text, gotIt: [] };
    s.broadcasts.push(b); renderShow();
    toast(`Sent to all ${VENDORS.length} vendors.`);
    VENDORS.filter((v) => v.id !== s.viewAs).forEach((v, i) => later(() => { if (!b.gotIt.includes(v.id)) { b.gotIt.push(v.id); keepFocus(renderShow); } }, 700 + 500 * i));
  };
  $('viewAs').onchange = (e) => { s.viewAs = e.target.value; renderShow(); renderPhones(); };
  $('alertToggle').onclick = () => {
    const open = $('alertForm').hidden;
    $('alertForm').hidden = !open; $('alertToggle').setAttribute('aria-expanded', String(open));
    if (open) $('alertText').focus();
  };
  $('alertSend').onclick = () => {
    const text = $('alertText').value.trim().slice(0, 200);
    if (!text) { toast('Write what is going on first.'); return; }
    s.alerts.push({ id: 'a' + ++s.seq, vendor: s.viewAs, text, seen: false, resolved: false });
    $('alertForm').hidden = true; $('alertToggle').setAttribute('aria-expanded', 'false'); $('alertToggle').focus();
    renderShow(); toast('Alert sent. It just landed on the console.');
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-checkin],[data-got],[data-alert],[data-review]');
    if (!el) return;
    if (el.hasAttribute('data-checkin')) { s.checkins[s.viewAs] = true; renderShow(); toast(`${vendor(s.viewAs).name} checked in. The console sees it.`); focusPhone(el); }
    else if (el.dataset.got) { const b = s.broadcasts.find((x) => x.id === el.dataset.got); if (b && !b.gotIt.includes(s.viewAs)) b.gotIt.push(s.viewAs); renderShow(); toast('Got it. The coordinator can see you read it.'); focusPhone(el); }
    else if (el.dataset.alert) {
      const a = s.alerts.find((x) => x.id === el.dataset.id); if (!a) return;
      if (el.dataset.alert === 'seen') a.seen = true; else { a.seen = true; a.resolved = true; }
      keepFocus(renderShow, 'bcText'); toast(el.dataset.alert === 'seen' ? 'Marked seen. The vendor knows we have it.' : 'Resolved.');
    } else if (el.hasAttribute('data-review')) toast('In a real wrap, this opens our Google review page.');
  });
  function focusPhone(el) {
    const screen = el.closest('.screen');
    if (screen) { screen.tabIndex = -1; screen.focus({ preventScroll: true }); }
  }
  function renderShow() { renderConsole(); renderPhones(); renderWrap(); }

  /* 4. Wrap */
  function renderWrap() {
    const open = s.alerts.filter((a) => !a.resolved).length;
    $('gates').innerHTML = [
      [open === 0, open === 0 ? 'Every alert resolved' : `${open} open alert${open === 1 ? '' : 's'}. Resolve on the console.`],
      [s.cur >= 0, s.cur >= 0 ? `${s.cur + 1} of ${MOMENTS.length} moments called` : 'Show not started yet (fine for the demo)'],
      [true, `${VENDORS.filter((v) => s.checkins[v.id]).length} of ${VENDORS.length} vendors checked in`],
    ].map(([ok, txt]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '!'} ${esc(txt)}</li>`).join('');
    $('closeBtn').hidden = s.closed;
    $('closeDone').hidden = !s.closed;
  }
  $('closeBtn').onclick = () => {
    const c = closeOutCheck(s);
    $('closeErr').textContent = c.reason;
    if (!c.ok) return;
    s.closed = true; timers.forEach(clearTimeout); timers = [];
    renderAll(); $('closeDone').tabIndex = -1; $('closeDone').focus();
    toast("Show closed out. That's a wrap.");
  };
  $('restart').onclick = () => {
    timers.forEach(clearTimeout); timers = []; s = fresh();
    $('signName').value = ''; $('signConsent').checked = false; $('days').value = 120; $('viewAs').value = 'photo';
    ['signErr', 'songErr', 'closeErr'].forEach((id) => ($(id).textContent = ''));
    select('book', true); toast('Fresh start.');
  };

  function renderAll() { renderBook(); renderPlan(); renderShow(); }
  renderAll();
})(typeof window !== 'undefined' ? window : globalThis);
