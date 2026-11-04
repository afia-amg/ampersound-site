/* Coordinator console: /cue/<event>/control. Runs the show; sees vendors and alerts. */
(function () {
  'use strict';
  const { store, esc, fmt, countdown, at, ago, showNow, stateOf, lane, driftLabel, call, toast, flash, buzz, poll } = window.CUE;
  const slug = location.pathname.split('/').filter(Boolean)[1] || '';
  const app = document.getElementById('app');
  const KEY = 'cue:coordinator-key';
  const CHECKS = [
    ['timeline', 'Timeline approved by the client or planner, and locked'],
    ['caller', 'Show caller and backup named. Only one device calls GO'],
    ['contacts', 'Every vendor has a working phone number on file'],
    ['links', 'Every vendor link sent, and each vendor opened it'],
    ['signal', 'Signal tested at the spot where you will call GO'],
    ['printed', 'Printed run sheet in hand, in case the app goes down'],
  ];
  const FLOW = ['go', 'finish', 'undo', 'reset', 'mode', 'closeout', 'reopen'];
  let lastSig = '', key = store.get(KEY) || '', data = null, skew = 0, laneSel = null, busy = false, failed = 0, lastOk = 0;
  let seenAlerts = null, armed = null, armTimer = null, sending = null;
  let draft = '', draftLevel = 'note', draftTo = ''; // message draft: kept outside the DOM so refreshes never wipe it

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
    // Signed out: draw the passcode screen once. Background refreshes must never redraw it,
    // or they wipe whatever is being typed.
    if (!key) { if (!document.getElementById('gate')) gate(); return; }
    try {
      apply(await call({ e: slug, k: key }));
    } catch (e) {
      if (e.status === 401) { store.del(KEY); key = ''; return gate('That passcode didn\'t work.'); }
      if (e.status === 404) { app.innerHTML = '<div class="center"><h2>Event not found</h2><p>Check the link.</p></div>'; return; }
      failed++;
      if (failed === 2) buzz([200, 100, 200]);
      if (data) render(); else app.innerHTML = `<div class="center"><h2>Can't reach the Cue Sheet</h2><p>${esc(e.message)}. Retrying…</p></div>`;
    }
  }
  function apply(d) {
    skew = d.now - Date.now();
    lastOk = Date.now();
    const wasStale = failed >= 2;
    failed = 0;
    const open = d.alerts.filter((a) => !a.resolved);
    if (seenAlerts) {
      const fresh = d.alerts.filter((a) => !seenAlerts.has(a.id));
      fresh.forEach((a) => toast(`${a.level === 'urgent' ? '🚨' : '📣'} ${a.by}: ${a.text}`));
      if (fresh.some((a) => a.level === 'urgent')) buzz([300, 120, 300, 120, 300]);
    }
    seenAlerts = new Set(d.alerts.map((a) => a.id));
    const sig = JSON.stringify([d.state, d.alerts, d.vendors, d.ready, open.length, d.broadcasts, d.closed, d.review]);
    const same = data && sig === lastSig && !wasStale;
    data = d; lastSig = sig;
    if (!laneSel || !d.event.lanes.includes(laneSel)) laneSel = d.event.lanes[0];
    if (!same) render();
  }
  const laneKey = () => (data.event.lanes.length > 1 ? laneSel : null);

  async function act(body, after) {
    if (busy) return false;
    busy = true; render();
    const payload = { e: slug, k: key, ...body };
    if (FLOW.includes(body.action)) payload.rev = data.state.rev;
    let ok = false;
    try { apply(await call(null, payload)); ok = true; if (after) after(); }
    catch (e) {
      if (e.status === 401) { toast('Passcode changed. Sign in again.'); store.del(KEY); key = ''; gate(); }
      else if (e.status === 409 && e.data && e.data.event) { apply(e.data); toast(e.data.error || 'The show changed. Check the screen.'); }
      else { failed = Math.max(failed, 1); throw e; }
    }
    finally { busy = false; sending = null; if (data && key) render(); }
    return ok;
  }
  async function go(m) {
    if (busy) return;
    sending = m.title;
    try {
      const ok = await act({ action: 'go', momentId: m.id });
      // Only celebrate after the server has saved the GO; vendors pick it up on their next refresh.
      if (ok) { flash(m.title, 'Confirmed'); toast(`Confirmed: ${m.title}`, { label: 'Undo', run: () => safe({ action: 'undo' }, 'Last GO undone') }); }
    } catch (_) {
      buzz([200, 100, 200]);
      toast(`GO did NOT go through: ${m.title}. Call it by phone or radio, then tap GO again.`);
    }
  }
  async function safe(body, okMsg) {
    try { if (await act(body) && okMsg) toast(okMsg); }
    catch (_) { toast("Didn't go through. Nothing changed. Try again."); }
  }
  function arm(name, msg) {
    armed = name; clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = null; render(); }, 6000);
    render(); toast(msg);
  }
  function disarm() { armed = null; clearTimeout(armTimer); }
  async function broadcast() {
    const text = draft.trim();
    if (!text || busy) return;
    const n = data.vendors.length, target = data.vendors.find((v) => v.id === draftTo);
    try {
      if (await act({ action: 'broadcast', text, level: draftLevel, ...(target ? { to: target.id } : {}) })) {
        // Back to Everyone after each send, and the button always names who it goes to.
        draft = ''; draftLevel = 'note'; draftTo = ''; render();
        toast(target ? `Sent to ${target.name}. Watch for Got it.` : `Sent to all ${n} vendors. Watch for Got it.`);
      }
    } catch (_) { toast("Didn't send. Your message is still here. Try again, or call."); }
  }

  function printable(ev, roles) {
    return `<section class="printable" aria-hidden="true">
      <h1>${esc(ev.name)} · Run sheet</h1>
      <p>${esc(ev.dateLabel)} · ${esc(ev.venue)} · Coordinator ${esc(ev.coordinator.name)} ${esc(ev.coordinator.phoneLabel)}</p>
      <p><b>If the app goes down:</b> run from this sheet. Call cues by phone or radio. Check vendors in by name.</p>
      <table><thead><tr><th>Time</th><th>Moment</th><th>Where</th><th>Who</th><th>Done</th></tr></thead><tbody>
      ${data.moments.slice().sort((a, b) => a.time - b.time).map((m) => `<tr><td>${fmt(m.time)}</td><td>${esc(m.title)}${m.notes ? `<br><small>${esc(m.notes)}</small>` : ''}</td><td>${esc(m.location || '')}</td><td>${esc((m.vendors || []).map((id) => roles[id]).filter(Boolean).join(', '))}</td><td>☐</td></tr>`).join('')}
      </tbody></table>
      <h2>Vendors</h2>
      <table><thead><tr><th>Vendor</th><th>Role</th><th>Arrive by</th><th>Contact</th><th>Here</th></tr></thead><tbody>
      ${data.vendors.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.role)}</td><td>${fmt(v.arrival)}</td><td>${esc(v.contact || 'MISSING')}</td><td>☐</td></tr>`).join('')}
      </tbody></table>
      <p><small>Printed ${esc(at(Date.now(), ev.tz))}. Ampersound Media Group</small></p>
    </section>`;
  }

  // After close out the console becomes a wrap-up screen: who tapped the review link, and Reopen.
  function renderClosed() {
    const ev = data.event, c = data.closed, stale = failed >= 2;
    const tapped = new Set((data.review && data.review.tapped) || []), total = data.vendors.length;
    const offDay = data.linksOffAt ? new Date(data.linksOffAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ev.tz }) : '';
    app.innerHTML = `<div class="screen">
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(ev.name)} · Control</b><span>${esc(ev.dateLabel)} · ${esc(ev.venue)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i><span id="syncval">${stale ? 'Offline since ' + at(lastOk, ev.tz) : 'Synced ' + ago(lastOk)}</span></div>
      </header>
      <section class="desk wrapup">
        <div class="kicker live">Closed out · ${esc(at(c.at, ev.tz))} · ${esc(c.by)}</div>
        <div class="big">That's a wrap.</div>
        <p class="meta">${c.wrapped ? 'The ClickUp task is now WRAPPED.' : '<span class="warn" style="display:inline">The task did not move to WRAPPED. Move it by hand in ClickUp.</span>'} Vendors see a thank-you with your Google review link instead of the timeline${offDay ? `, and their links turn off on ${esc(offDay)}` : ''}.</p>
        <div class="tally"><b>${tapped.size}</b><span>of ${total} vendors opened the review link</span></div>
        <p class="meta">Opening the link isn't proof they posted. Check Google for the actual reviews.</p>
      </section>
      <div class="grid">
        <div>
          <h2 class="h2" style="margin-top:1.5rem">Google review</h2>
          <ul class="vend">
            ${data.vendors.map((v) => { const phone = /^[+\d][\d\s().-]{6,}$/.test(v.contact || '') ? v.contact.replace(/[^\d+]/g, '') : ''; const body = encodeURIComponent(`Thank you for ${ev.name}, ${v.name}! If we earned it, a quick Google review helps us a lot: ${data.review.url}  - Ampersound Media Group`); return `<li><div class="x"><b>${esc(v.name)}</b><small class="${tapped.has(v.id) ? 'in' : ''}">${esc(v.role)} · ${tapped.has(v.id) ? '✓ Opened the review link' : 'Not yet'}</small></div>${tapped.has(v.id) || !phone ? '' : `<a class="icon" href="sms:${esc(phone)}?&body=${body}" aria-label="Text ${esc(v.name)} a review nudge">Nudge</a>`}</li>`; }).join('')}
          </ul>
          <div class="row2" style="margin-top:1rem">
            <button class="btn ghost" type="button" id="copyReview">Copy review link</button>
            <button class="btn ghost" type="button" id="reopen" style="${armed === 'reopen' ? 'border-color:var(--bad);color:var(--bad)' : ''}" ${busy ? 'disabled' : ''}>${armed === 'reopen' ? 'Tap again to reopen' : 'Reopen the show'}</button>
          </div>
        </div>
        <div>
          <h2 class="h2" style="margin-top:1.5rem">Before you go</h2>
          <ul class="list wraplist">
            <li><span class="x">✓ Every alert resolved</span></li>
            <li><span class="x">${c.wrapped ? '✓' : '☐'} ClickUp task moved to WRAPPED</span></li>
            <li><span class="x">✓ Vendors thanked and asked for a Google review</span></li>
            <li><span class="x">☐ Debrief notes go on the Post-Event task (Rex creates it)</span></li>
          </ul>
        </div>
      </div>
      <p class="foot">Ampersound Media Group · Sound. Presence. Atmosphere. · <button type="button" id="signout" style="background:none;border:none;color:var(--gold-text);cursor:pointer;font-size:inherit">Sign out on this device</button></p>
    </div>`;
    const $ = (id) => document.getElementById(id);
    $('copyReview').onclick = async () => { try { await navigator.clipboard.writeText(data.review.url); toast('Review link copied'); } catch (_) { prompt('Copy this link', data.review.url); } };
    $('reopen').onclick = () => {
      if (armed !== 'reopen') return arm('reopen', 'Tap Reopen again. Vendors get the timeline back and the task leaves WRAPPED.');
      disarm(); safe({ action: 'reopen' }, 'Reopened. The show is live again.');
    };
    $('signout').onclick = () => { store.del(KEY); key = ''; data = null; gate(); };
  }
  async function closeOut() {
    try {
      if (await act({ action: 'closeout' })) { toast("Closed out. Vendors now see your thank-you and the Google review link."); buzz(120); }
    } catch (_) { toast("Didn't close out. Nothing changed. Try again."); }
  }

  function render() {
    if (!data || !key) return;
    if (data.closed) return renderClosed();
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
    const ready = new Set(data.ready || []), allReady = CHECKS.every(([id]) => ready.has(id));
    const noPhone = data.vendors.filter((v) => !/^[+\d][\d\s().-]{6,}$/.test(v.contact || '')).length;
    const open = data.alerts.filter((a) => !a.resolved);
    const urgentNew = open.filter((a) => a.level === 'urgent' && !a.ack);

    const alertRow = (a) => `<li class="${a.level === 'urgent' && !a.ack ? 'hot' : ''}"><i class="dot ${a.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(a.text)}</div>
      <small>${esc(a.by)} · ${fmt(a.show)} · <span class="st ${a.resolved ? 'ok' : a.ack ? '' : 'new'}">${a.resolved ? 'Resolved' : a.ack ? 'Seen' : 'Not seen yet'}</span></small></div>
      ${a.resolved ? '' : `<div class="acts">${a.ack ? '' : `<button class="icon" type="button" data-ack="${esc(a.id)}">Seen</button>`}<button class="icon" type="button" data-resolve="${esc(a.id)}">Resolved</button></div>`}</li>`;

    const sent = data.broadcasts || [], total = data.vendors.length;
    const vname = (id) => (data.vendors.find((v) => v.id === id) || {}).name || 'a vendor';
    const sentRow = (b) => {
      if (b.from) {
        const others = total - 1, got = b.gotIt.length;
        return `<li><i class="dot"></i><div class="x"><div>${esc(b.text)}</div>
      <small>💬 ${esc(vname(b.from))} to ${b.to ? esc(vname(b.to)) : 'everyone'} · ${fmt(b.show)} · <span class="st ${b.to ? (got ? 'ok' : 'new') : got >= others ? 'ok' : ''}">${b.to ? (got ? 'Got it' : 'Not seen yet') : got + ' of ' + others + ' got it'}</span></small></div></li>`;
      }
      const status = b.to
        ? `<span class="st ${b.gotIt.length ? 'ok' : 'new'}">${b.gotIt.length ? 'Got it' : 'Not seen yet'}</span>`
        : (() => { const got = b.gotIt.length, all = got >= total, waiting = data.vendors.filter((v) => !b.gotIt.includes(v.id)).map((v) => v.name);
          return `<span class="st ${all ? 'ok' : got ? '' : 'new'}">${got} of ${total} got it</span>${!all && got && waiting.length <= 3 ? ` · Waiting on ${esc(waiting.join(', '))}` : ''}`; })();
      return `<li><i class="dot ${b.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(b.text)}</div>
      <small>${b.to ? 'To ' + esc(vname(b.to)) + ' · ' : ''}${fmt(b.show)} · ${status}</small></div></li>`; };
    const toVendor = data.vendors.find((v) => v.id === draftTo) || null;
    // Refreshes redraw the screen. Keep the cursor where it was if someone is typing a message.
    const typing = document.activeElement && document.activeElement.id === 'bcText' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;

    app.innerHTML = `<div class="screen">
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(ev.name)} · Control</b><span>${esc(ev.dateLabel)} · ${esc(ev.venue)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i><span id="syncval">${stale ? 'Offline since ' + at(lastOk, ev.tz) : 'Synced ' + ago(lastOk)}</span></div>
      </header>
      ${stale ? `<div class="banner" role="alert"><b>Not connected since ${esc(at(lastOk, ev.tz))}.</b> Vendors are not getting updates and GO may not save. Call cues by phone or radio and run from the printed sheet.</div>` : ''}
      ${urgentNew.length ? `<div class="banner" role="alert">🚨 <b>${urgentNew.length} urgent alert${urgentNew.length > 1 ? 's' : ''} not seen:</b> ${urgentNew.map((a) => esc(a.by + ': ' + a.text)).join(' · ')}. Tap Seen so they know you have it.</div>` : ''}
      <div class="modes" style="margin-bottom:1rem">
        <span>Clock</span>
        <div class="seg" role="group" aria-label="Clock">
          <button type="button" data-mode="practice" aria-pressed="${!isLive}" ${armed === 'practice' ? 'class="armed"' : ''}>${armed === 'practice' ? 'Tap again' : 'Practice'}</button>
          <button type="button" data-mode="live" aria-pressed="${isLive}" ${!isLive && !allReady ? 'disabled title="Finish the pre-show check first"' : ''} ${armed === 'live' ? 'class="armed"' : ''}>${armed === 'live' ? 'Tap again' : 'Show day'}</button>
        </div>
        <span>${isLive ? 'Show day: real time, practice data cleared' : allReady ? 'Ready. Show day starts a clean slate' : 'Practice. Show day unlocks after the pre-show check'}</span>
        <button class="icon" type="button" id="print" style="margin-left:auto">Print run sheet</button>
      </div>
      ${!isLive ? `<section class="card check">
        <h2 class="h2">Pre-show check · ${ready.size} of ${CHECKS.length}</h2>
        <ul>${CHECKS.map(([id, label]) => `<li><label><input type="checkbox" data-ready="${id}" ${ready.has(id) ? 'checked' : ''}> <span>${esc(label)}${id === 'contacts' && noPhone ? ` <small class="warn">${noPhone} of ${data.vendors.length} vendors have no phone number on file</small>` : ''}</span></label></li>`).join('')}</ul>
      </section>` : ''}
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
              <button class="btn go" id="go" type="button" ${!L.next || busy ? 'disabled' : ''}>${sending ? 'SENDING <small>' + esc(sending) + '…</small>' : 'GO <small>' + (L.next ? esc(L.next.title) : 'Nothing left') + '</small>'}</button>
              ${L.live ? `<button class="btn ghost" id="finish" type="button" ${busy ? 'disabled' : ''}>Finish</button>` : ''}
            </div>
            <p class="meta" style="margin-top:0.6rem">A GO only counts once it says Confirmed. Vendors catch up within about 15 seconds. For split-second cues, also call it out loud. Space bar works too.</p>
          </section>
          <h2 class="h2" style="margin-top:1.5rem">Schedule${data.playlist && data.playlist.url ? ` <a class="icon" href="${esc(data.playlist.url)}" target="_blank" rel="noopener" style="margin-left:0.5rem;font-size:0.875rem">🎧 Couple's playlist</a>` : ''}</h2>
          <ol class="list sched">
            ${L.rows.map((m) => { const st = stateOf(m, s), nx = L.next && L.next.id === m.id; return `<li class="${st === 'live' ? 'now' : st === 'done' ? 'done' : nx ? 'next' : ''}"><span class="t">${fmt(m.time)}${st === 'pending' && lateBy ? `<small style="display:block;color:${lateBy > 0 ? 'var(--bad)' : 'var(--gold-text)'};font-family:var(--body);font-weight:400;font-size:.875rem">~${fmt(m.time + L.drift)}</small>` : ''}</span><span class="x">${esc(m.title)}<small>${esc([m.location, (m.vendors || []).map((id) => roles[id]).filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>${(m.music || []).map((x) => `<small class="song">🎵 ${esc(x.label)}: <b>${esc(x.song)}</b></small>`).join('')}</span>${st === 'pending' ? `<button class="go" type="button" data-go="${esc(m.id)}" ${busy ? 'disabled' : ''} aria-label="GO: start ${esc(m.title)}">GO</button>` : st === 'live' ? '<span class="meta">Now</span>' : '✓'}</li>`; }).join('')}
          </ol>
          <div class="row2" style="margin-top:1rem">
            <button class="btn ghost" id="undo" type="button" ${Object.keys(s.calls).length && !busy ? '' : 'disabled'}>Undo last GO</button>
            <button class="btn ghost" id="reset" type="button" aria-live="polite" style="${armed === 'reset' ? 'border-color:var(--bad);color:var(--bad)' : ''}">${armed === 'reset' ? 'Tap again to reset' : 'Reset the day'}</button>
          </div>
          ${isLive ? `<section class="card closeout ${wrapped ? 'ready' : ''}" style="margin-top:1rem">
            <h2 class="h2">Close out the event</h2>
            <p class="meta">Moves the task to WRAPPED and thanks every vendor with your Google review link. Their timeline and phone numbers come down.</p>
            ${open.length ? `<p class="warn">Resolve ${open.length === 1 ? 'the open alert' : 'all ' + open.length + ' open alerts'} first.</p>` : ''}
            <button class="btn ${wrapped ? '' : 'ghost'}" id="closeout" type="button" ${open.length || busy || stale ? 'disabled' : ''} style="${armed === 'closeout' ? 'border-color:var(--gold);color:var(--gold-text)' : ''}">${armed === 'closeout' ? 'Tap again to close out' : '🏁 Close out and ask for reviews'}</button>
          </section>` : ''}
        </div>
        <div>
          <h2 class="h2">Alerts${open.length ? ' · ' + open.length + ' open' : ''}</h2>
          ${data.alerts.length ? `<ul class="alerts">${open.concat(data.alerts.filter((a) => a.resolved)).slice(0, 10).map(alertRow).join('')}</ul>` : '<p class="meta" style="margin-bottom:1rem">Quiet so far. Vendor alerts show up here and in ClickUp.</p>'}
          <section class="card bc" style="margin-top:1.5rem">
            <h2 class="h2">Message vendors</h2>
            <label class="to"><span>To</span><select id="bcTo" aria-label="Who gets this message">
              <option value="">Everyone (${total})</option>
              ${data.vendors.map((v) => `<option value="${esc(v.id)}" ${v.id === draftTo ? 'selected' : ''}>${esc(v.name)} · ${esc(v.role)}</option>`).join('')}
            </select></label>
            <textarea id="bcText" maxlength="500" aria-label="Message to every vendor" placeholder="e.g. Toasts moved up 10 min. Photo and video to the patio.">${esc(draft)}</textarea>
            <div class="bc-row">
              <div class="seg" role="group" aria-label="How urgent">
                <button type="button" data-bclevel="note" aria-pressed="${draftLevel === 'note'}">Heads up</button>
                <button type="button" data-bclevel="urgent" class="urgent" aria-pressed="${draftLevel === 'urgent'}">Urgent</button>
              </div>
              <button class="btn" id="bcSend" type="button" ${!draft.trim() || busy || stale ? 'disabled' : ''}>${toVendor ? 'Send to ' + esc(toVendor.name) : 'Send to all ' + total}</button>
            </div>
            <p class="meta" style="margin-top:0.5rem">${toVendor ? `Only ${esc(toVendor.name)} sees this.` : "Shows on every vendor's page."} Arrives within about 15 seconds. They tap Got it.</p>
            ${sent.some((b) => !b.from) ? `<ul class="alerts" style="margin-top:0.75rem">${sent.filter((b) => !b.from).slice(0, 4).map(sentRow).join('')}</ul>` : ''}
          </section>
          ${sent.some((b) => b.from) ? `<h2 class="h2" style="margin-top:1.5rem">Between vendors</h2><ul class="alerts">${sent.filter((b) => b.from).slice(0, 6).map(sentRow).join('')}</ul>` : ''}
          <h2 class="h2" style="margin-top:1.5rem">Vendors · ${data.vendors.filter((v) => v.checkedIn).length} of ${data.vendors.length} here</h2>
          <p class="meta contact">Vendors' point of contact: <b>${esc(ev.coordinator.name)}</b>${ev.coordinator.phoneLabel ? ' · ' + esc(ev.coordinator.phoneLabel) : ' · <span class="warn" style="display:inline">no phone, vendors can\'t call</span>'}. Change it in ClickUp under Point of Contact.</p>
          <ul class="vend">
            ${data.vendors.map((v) => { const late = isLive && !v.checkedIn && now != null && now > v.arrival; const phone = /^[+\d][\d\s().-]{6,}$/.test(v.contact || '') ? v.contact.replace(/[^\d+]/g, '') : ''; const body = encodeURIComponent(`Hi ${v.name}! Here's your live timeline for ${ev.name} (${ev.dateLabel}). No login needed: ${v.link}  - ${ev.coordinator.name}`); return `<li><div class="x"><b>${esc(v.name)}</b><small class="${v.checkedIn ? 'in' : late ? 'late' : ''}">${esc(v.role)} · ${v.checkedIn ? 'Here since ' + fmt(v.checkedIn.show) : late ? 'Late, due ' + fmt(v.arrival) : 'Arrive by ' + fmt(v.arrival)}${phone ? '' : ' · no phone'}</small></div>${phone ? `<a class="icon" href="tel:${esc(phone)}" aria-label="Call ${esc(v.name)}">Call</a>` : ''}<a class="icon" href="sms:${esc(phone)}?&body=${body}" aria-label="Text ${esc(v.name)} their link">Text</a><button class="icon" type="button" data-copy="${esc(v.link)}" aria-label="Copy ${esc(v.name)}'s link">Copy</button></li>`; }).join('')}
          </ul>
          <p class="meta" style="margin-top:0.75rem">Each link is private to that vendor. To turn one off, ask Brain to reset that vendor's link.</p>
        </div>
      </div>
      <p class="foot">Ampersound Media Group · Sound. Presence. Atmosphere. · <button type="button" id="signout" style="background:none;border:none;color:var(--gold-text);cursor:pointer;font-size:inherit">Sign out on this device</button></p>
    </div>${printable(ev, roles)}`;

    const $ = (id) => document.getElementById(id);
    const bt = $('bcText');
    if (typing) { bt.focus(); try { bt.setSelectionRange(typing[0], typing[1]); } catch (_) { /* ignore */ } }
    bt.oninput = () => { draft = bt.value; $('bcSend').disabled = !draft.trim() || busy || failed >= 2; };
    bt.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); broadcast(); } };
    $('bcSend').onclick = broadcast;
    $('bcTo').onchange = (e) => { draftTo = e.target.value; render(); };
    app.querySelectorAll('[data-bclevel]').forEach((b) => (b.onclick = () => { draftLevel = b.dataset.bclevel; app.querySelectorAll('[data-bclevel]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    if ($('go')) $('go').onclick = () => L.next && go(L.next);
    if ($('finish')) $('finish').onclick = () => safe({ action: 'finish', momentId: L.live.id });
    $('undo').onclick = () => safe({ action: 'undo' }, 'Last GO undone');
    $('print').onclick = () => window.print();
    // Two taps instead of a browser pop-up: pop-ups are blocked inside some phone browsers.
    $('reset').onclick = () => {
      if (armed !== 'reset') return arm('reset', 'Tap Reset again to clear every GO, check-in and alert. The schedule stays.');
      disarm(); safe({ action: 'reset' }, 'Day reset. Clean slate.');
    };
    $('signout').onclick = () => { store.del(KEY); key = ''; data = null; gate(); };
    if ($('closeout')) $('closeout').onclick = () => {
      if (armed !== 'closeout') return arm('closeout', 'Tap Close out again. Vendors get the thank-you and the review link, and the show freezes.');
      disarm(); closeOut();
    };
    app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const m = data.moments.find((x) => x.id === b.dataset.go); if (m) go(m); }));
    app.querySelectorAll('[data-lane]').forEach((b) => (b.onclick = () => { laneSel = b.dataset.lane; render(); }));
    app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
      const to = b.dataset.mode;
      if ((to === 'live') === isLive) return;
      const risky = to === 'live' || Object.keys(s.calls).length > 0;
      if (risky && armed !== to) return arm(to, to === 'live' ? 'Tap Show day again. This clears practice GOs, check-ins and alerts.' : 'Tap Practice again. The show is in progress.');
      disarm(); safe({ action: 'mode', mode: to }, to === 'live' ? 'Show day is on. Clean slate.' : 'Back to practice');
    }));
    app.querySelectorAll('[data-ready]').forEach((b) => (b.onchange = () => safe({ action: 'ready', item: b.dataset.ready, on: b.checked })));
    app.querySelectorAll('[data-ack]').forEach((b) => (b.onclick = () => safe({ action: 'ack', alertId: b.dataset.ack }, 'Marked seen. The vendor can see that.')));
    app.querySelectorAll('[data-resolve]').forEach((b) => (b.onclick = () => safe({ action: 'resolve', alertId: b.dataset.resolve }, 'Resolved')));
    app.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch (_) { prompt('Copy this link', b.dataset.copy); } }));
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !data || !key || data.closed || /^(INPUT|TEXTAREA|BUTTON|A|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    const multi = data.event.lanes.length > 1;
    const L = lane(data.moments.map((m) => ({ ...m, lane: multi ? m.lane : null })), data.state, laneKey());
    if (L.next) { e.preventDefault(); go(L.next); }
  });

  // Every second, update only the clock, countdown and sync label so buttons never move under a finger.
  function tick() {
    if (!data || !key) return;
    if (data.closed) { const sv = document.getElementById('syncval'); if (sv && failed < 2) sv.textContent = 'Synced ' + ago(lastOk); return; }
    const ev = data.event, s = data.state, multi = ev.lanes.length > 1;
    const now = showNow(s, ev.tz, skew);
    const L = lane(data.moments.map((m) => ({ ...m, lane: multi ? m.lane : null })), s, laneKey());
    const c = document.getElementById('clockval');
    if (c && now != null) c.innerHTML = fmt(now).replace(/ (AM|PM)/, '<small>$1</small>');
    const sv = document.getElementById('syncval');
    if (sv && failed < 2) sv.textContent = 'Synced ' + ago(lastOk);
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
