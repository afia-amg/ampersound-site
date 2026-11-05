/* Room console: /cue/<event>/room/<room-link-code>. A stage manager runs one room of a multi-room
   show: that room's GO, finish and undo, its crew, and a line to the show caller. No passcode; the
   private link is the pass, and it can only touch this one room. */
(function () {
  'use strict';
  const parts = location.pathname.split('/').filter(Boolean); // ["cue", event, "room", code]
  if (parts[2] !== 'room') return;
  const { esc, fmt, countdown, at, ago, showNow, stateOf, lane, driftLabel, call, toast, flash, buzz, poll } = window.CUE;
  const slug = parts[1] || '', code = parts[3] || '';
  const app = document.getElementById('app');
  let data = null, lastSig = '', skew = 0, busy = false, sending = null, failed = 0, lastOk = 0, seenMsgs = null;
  let draft = '', draftLevel = 'note';

  function apply(d) {
    skew = d.now - Date.now(); lastOk = Date.now();
    const wasStale = failed >= 2; failed = 0;
    if (seenMsgs) {
      const fresh = (d.broadcasts || []).filter((b) => !seenMsgs.has(b.id));
      fresh.forEach((b) => toast(`${b.level === 'urgent' ? '🚨' : '📢'} Show caller: ${b.text}`));
      if (fresh.length) buzz(fresh.some((b) => b.level === 'urgent') ? [300, 120, 300] : [120, 80, 120]);
    }
    seenMsgs = new Set((d.broadcasts || []).map((b) => b.id));
    const sig = JSON.stringify([d.state, d.crew, d.broadcasts, d.myAlerts, d.moments, d.closed]);
    const same = data && sig === lastSig && !wasStale;
    data = d; lastSig = sig;
    if (!same) render();
  }
  async function load() {
    try { apply(await call({ e: slug, r: code })); }
    catch (e) {
      if (e.status === 404 || e.status === 401) { app.innerHTML = '<div class="center"><h2>This room link is turned off</h2><p>Ask the show caller for a new one.</p></div>'; return; }
      failed++;
      if (failed === 2) buzz([200, 100, 200]);
      if (data) render(); else app.innerHTML = `<div class="center"><h2>Can't reach the Cue Sheet</h2><p>${esc(e.message)}. Retrying…</p></div>`;
    }
  }
  const L = () => lane(data.moments, data.state, data.room);
  async function act(body) {
    if (busy) return false;
    busy = true; render();
    let ok = false;
    try { apply(await call(null, { e: slug, r: code, laneRev: (data.state.laneRev || {})[data.room] || 0, ...body })); ok = true; }
    catch (e) {
      if (e.status === 409 && e.data && e.data.event) { apply(e.data); toast(e.data.error || 'The room changed. Check the screen.'); }
      else if (e.status === 409) toast(e.message);
      else { failed = Math.max(failed, 1); throw e; }
    } finally { busy = false; sending = null; if (data) render(); }
    return ok;
  }
  async function go(m) {
    if (busy) return;
    sending = m.title;
    try {
      if (await act({ action: 'go', momentId: m.id })) { flash(m.title, 'Confirmed'); toast(`Confirmed: ${m.title}`, { label: 'Undo', run: () => safe({ action: 'undo' }, 'Last GO undone') }); }
    } catch (_) { buzz([200, 100, 200]); toast(`GO did NOT go through: ${m.title}. Call it on radio, then tap GO again.`); }
  }
  async function safe(body, okMsg) {
    try { if (await act(body) && okMsg) toast(okMsg); } catch (_) { toast("Didn't go through. Nothing changed. Try again."); }
  }
  async function sendMsg() {
    const text = draft.trim();
    if (!text || busy) return;
    busy = true; render();
    try {
      await call(null, { e: slug, r: code, action: 'alert', text, level: draftLevel, cid: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
      draft = ''; draftLevel = 'note';
      toast('Sent to the show caller.');
      busy = false; await load();
    } catch (_) { toast("Didn't send. Your message is still here. Try again, or use the radio."); }
    finally { busy = false; render(); }
  }

  function render() {
    if (!data) return;
    const ev = data.event, s = data.state, room = data.room, stale = failed >= 2;
    if (data.closed) {
      app.innerHTML = `<div class="screen"><div class="center"><div class="kicker live">${esc(ev.name)} · ${esc(room)}</div><h2>That's a wrap.</h2><p>The show caller closed out the event. Thank you for running ${esc(room)}.</p></div></div>`;
      return;
    }
    const now = showNow(s, ev.tz, skew), R = L();
    const hero = R.live || R.next, wrapped = R.started && !R.live && !R.next;
    const left = R.live && now != null ? s.calls[R.live.id].show + R.live.dur - now : null, over = left != null && left < 0;
    const pct = R.live && now != null ? Math.min(100, Math.max(0, ((now - s.calls[R.live.id].show) / R.live.dur) * 100)) : 0;
    const crewName = (id) => (data.crew.find((c) => c.id === id) || {}).name;
    const lateBy = Math.round(R.drift);
    const typing = document.activeElement && document.activeElement.id === 'rmText' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    app.innerHTML = `<div class="screen">
      <header class="top">
        <img src="https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co" alt="AMG">
        <div class="ev"><b>${esc(room)} · Stage manager</b><span>${esc(ev.name)} · ${esc(ev.dateLabel)}</span></div>
        <div class="sync"><i class="dot ${stale ? 'bad' : 'live'}"></i><span id="syncval">${stale ? 'Offline since ' + at(lastOk, ev.tz) : 'Synced ' + ago(lastOk)}</span></div>
      </header>
      ${stale ? `<div class="banner" role="alert"><b>Not connected since ${esc(at(lastOk, ev.tz))}.</b> GO may not save. Call cues on radio and run from the printed sheet.</div>` : ''}
      ${(data.broadcasts || []).slice(0, 1).map((b) => `<div class="banner ${b.level === 'urgent' ? '' : 'ok'}" role="status">${b.level === 'urgent' ? '🚨' : '📢'} <b>${esc(b.by)}:</b> ${esc(b.text)} <small>· ${fmt(b.show)}</small></div>`).join('')}
      <div class="grid">
        <div>
          <section class="desk">
            <div class="kicker ${R.live ? 'live' : ''}">${R.live ? 'Happening now' : wrapped ? 'Done for the day' : 'Up next'}${hero && !wrapped ? ' · ' + fmt(hero.time) + (hero.location ? ' · ' + esc(hero.location) : '') : ''}</div>
            <div class="big">${esc(wrapped ? 'Room is done.' : hero ? hero.title : 'Nothing scheduled')}</div>
            ${hero && !wrapped ? `<div class="meta">${esc((hero.vendors || []).map(crewName).filter(Boolean).join(' · '))}${hero.call != null && !R.live ? ' · Call ' + fmt(hero.call) : ''}</div>` : ''}
            ${R.live ? `<div style="margin-top:0.9rem"><div class="bar"><i id="barfill" class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
              <div class="left"><span>Started ${fmt(s.calls[R.live.id].show)}</span><b id="leftval" class="${over ? 'over' : ''}">${left == null ? '' : over ? countdown(left) + ' over' : countdown(left) + ' left'}</b></div></div>` : ''}
            <div class="clock">
              <div><b id="clockval">${fmt(now != null ? now : hero ? hero.time : 0).replace(/ (AM|PM)/, '<small>$1</small>')}</b><div class="meta">${s.mode === 'live' ? 'Real time' : 'Practice clock'}</div></div>
              ${R.started ? `<span class="pill ${lateBy > 0 ? 'late' : ''}">${driftLabel(R.drift)}</span>` : ''}
            </div>
            ${R.live && R.next ? `<div class="meta" style="margin-bottom:0.25rem">Next: <b style="color:var(--text)">${esc(R.next.title)}</b> · ${lateBy ? 'now about ' + fmt(R.next.time + R.drift) : fmt(R.next.time)}</div>` : ''}
            <div class="ctrl">
              <button class="btn go" id="go" type="button" ${!R.next || busy ? 'disabled' : ''}>${sending ? 'SENDING <small>' + esc(sending) + '…</small>' : 'GO <small>' + (R.next ? esc(R.next.title) : 'Nothing left') + '</small>'}</button>
              ${R.live ? `<button class="btn ghost" id="finish" type="button" ${busy ? 'disabled' : ''}>Finish</button>` : ''}
            </div>
            <p class="meta" style="margin-top:0.6rem">This GO only runs ${esc(room)}. It counts once it says Confirmed. Space bar works too.</p>
          </section>
          <h2 class="h2" style="margin-top:1.5rem">${esc(room)} schedule</h2>
          <ol class="list sched">
            ${R.rows.map((m) => { const st = stateOf(m, s), nx = R.next && R.next.id === m.id; return `<li class="${st === 'live' ? 'now' : st === 'done' ? 'done' : nx ? 'next' : ''}"><span class="t">${fmt(m.time)}${st === 'pending' && lateBy ? `<small style="display:block;color:${lateBy > 0 ? 'var(--bad)' : 'var(--gold-text)'};font-family:var(--body);font-weight:400;font-size:.875rem">~${fmt(m.time + R.drift)}</small>` : ''}</span><span class="x">${esc(m.title)}<small>${esc([m.location, m.call != null ? 'Call ' + fmt(m.call) : '', (m.vendors || []).map(crewName).filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>${m.notes ? `<small>${esc(m.notes)}</small>` : ''}</span>${st === 'pending' ? `<button class="go" type="button" data-go="${esc(m.id)}" ${busy ? 'disabled' : ''} aria-label="GO: start ${esc(m.title)}">GO</button>` : st === 'live' ? '<span class="meta">Now</span>' : '✓'}</li>`; }).join('')}
          </ol>
          <div class="row2" style="margin-top:1rem"><button class="btn ghost" id="undo" type="button" ${R.started && !busy ? '' : 'disabled'}>Undo last GO in ${esc(room)}</button></div>
        </div>
        <div>
          <section class="card bc">
            <h2 class="h2">Message the show caller</h2>
            <textarea id="rmText" maxlength="500" aria-label="Message to the show caller" placeholder="e.g. Speaker running 5 min late. Holding doors.">${esc(draft)}</textarea>
            <div class="bc-row">
              <div class="seg" role="group" aria-label="How urgent">
                <button type="button" data-level="note" aria-pressed="${draftLevel === 'note'}">Heads up</button>
                <button type="button" data-level="urgent" class="urgent" aria-pressed="${draftLevel === 'urgent'}">Urgent</button>
              </div>
              <button class="btn" id="rmSend" type="button" ${!draft.trim() || busy ? 'disabled' : ''}>Send</button>
            </div>
            ${(data.myAlerts || []).length ? `<ul class="alerts" style="margin-top:0.75rem">${data.myAlerts.map((a) => `<li><i class="dot ${a.level === 'urgent' ? 'bad' : ''}"></i><div class="x"><div>${esc(a.text)}</div><small>${fmt(a.show)} · <span class="st ${a.resolved ? 'ok' : a.ack ? '' : 'new'}">${a.resolved ? 'Resolved' : a.ack ? 'Seen' : 'Not seen yet'}</span></small></div></li>`).join('')}</ul>` : ''}
          </section>
          <h2 class="h2" style="margin-top:1.5rem">Crew in ${esc(room)} · ${data.crew.filter((c) => c.checkedIn).length} of ${data.crew.length} here</h2>
          <ul class="vend">
            ${data.crew.map((c) => { const late = s.mode === 'live' && !c.checkedIn && now != null && c.arrival != null && now > c.arrival; return `<li><div class="x"><b>${esc(c.name)}</b><small class="${c.checkedIn ? 'in' : late ? 'late' : ''}">${esc(c.role)} · ${c.checkedIn ? 'Here since ' + fmt(c.checkedIn.show) : late ? 'Late, due ' + fmt(c.arrival) : c.arrival != null ? 'Arrive by ' + fmt(c.arrival) : 'Not checked in'}</small></div>${c.phone ? `<a class="icon" href="tel:${esc(c.phone)}" aria-label="Call ${esc(c.name)}">Call</a>` : ''}</li>`; }).join('') || '<li><div class="x"><small>No crew assigned to this room yet.</small></div></li>'}
          </ul>
          <p class="meta" style="margin-top:0.75rem">Phone numbers show only for crew who agreed to share them.</p>
        </div>
      </div>
      <p class="foot">Ampersound Media Group · Sound. Presence. Atmosphere.</p>
    </div>`;
    const $ = (id) => document.getElementById(id);
    const t = $('rmText');
    if (typing) { t.focus(); try { t.setSelectionRange(typing[0], typing[1]); } catch (_) { /* ignore */ } }
    t.oninput = () => { draft = t.value; $('rmSend').disabled = !draft.trim() || busy; };
    $('rmSend').onclick = sendMsg;
    app.querySelectorAll('[data-level]').forEach((b) => (b.onclick = () => { draftLevel = b.dataset.level; app.querySelectorAll('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    if ($('go')) $('go').onclick = () => R.next && go(R.next);
    if ($('finish')) $('finish').onclick = () => safe({ action: 'finish', momentId: R.live.id });
    $('undo').onclick = () => safe({ action: 'undo' }, 'Last GO undone');
    app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const m = data.moments.find((x) => x.id === b.dataset.go); if (m) go(m); }));
  }
  document.addEventListener('keydown', (e) => {
    if (!data || data.closed || /^(INPUT|TEXTAREA|BUTTON|A|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
    const R = L();
    if (e.code === 'Space' && R.next) { e.preventDefault(); go(R.next); }
    if (e.key === 'f' && R.live) { e.preventDefault(); safe({ action: 'finish', momentId: R.live.id }); }
  });
  setInterval(() => {
    if (!data || data.closed) return;
    const ev = data.event, s = data.state, now = showNow(s, ev.tz, skew), R = L();
    const c = document.getElementById('clockval'); if (c && now != null) c.innerHTML = fmt(now).replace(/ (AM|PM)/, '<small>$1</small>');
    const sv = document.getElementById('syncval'); if (sv && failed < 2) sv.textContent = 'Synced ' + ago(lastOk);
    if (R.live && now != null) {
      const left = s.calls[R.live.id].show + R.live.dur - now, over = left < 0;
      const lv = document.getElementById('leftval'), bf = document.getElementById('barfill');
      if (lv) { lv.textContent = over ? countdown(left) + ' over' : countdown(left) + ' left'; lv.className = over ? 'over' : ''; }
      if (bf) { bf.style.width = Math.min(100, Math.max(0, ((now - s.calls[R.live.id].show) / R.live.dur) * 100)) + '%'; bf.className = over ? 'over' : ''; }
    }
  }, 1000);
  if (!slug || !code) app.innerHTML = '<div class="center"><h2>This room link is turned off</h2></div>';
  else poll(load, 5000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    try { navigator.serviceWorker.register('/cue/sw.js', { scope: '/cue/' }).catch(() => {}); } catch (_) { /* unsupported */ }
  }
})();
