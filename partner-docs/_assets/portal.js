/* Ampersound client portal — shared engine.
 *
 * Every portal is a static page on ampersoundmediagroup.com. The page ships a
 * PORTAL record (client, pricing, seeds) and this engine renders it. No login,
 * no third-party app, nothing for a client to authenticate against.
 *
 * Two things matter more than the visuals here:
 *   1. Drafts survive. Every keystroke is written to localStorage so a client
 *      can close the tab mid-sentence and pick up where they left off.
 *   2. Submissions reach our backend. Songs, timelines, and signatures POST to
 *      our Netlify functions, which write to ClickUp. If a POST fails we say so
 *      plainly and keep the draft — we never fake a success.
 */
(function () {
  "use strict";

  var P = window.PORTAL;
  if (!P) return;

  var PLANNING = "/.netlify/functions/planning-submit";
  var AGREEMENT = "/.netlify/functions/agreement-webhook";
  var KEY = "amg-portal-" + P.slug + "-v1";

  /* ------------------------------------------------------------ storage */

  function readStore() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function writeStore(store) {
    try {
      store.updatedAt = new Date().toISOString();
      localStorage.setItem(KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      return false;
    }
  }
  // Merge saved draft over the seed so new seed fields appear for a client who
  // already has a draft, without clobbering anything they typed.
  function hydrate(seed, saved) {
    if (!saved || typeof saved !== "object") return clone(seed);
    var out = clone(seed);
    Object.keys(out).forEach(function (k) {
      var s = saved[k];
      if (s === undefined) return;
      if (Array.isArray(out[k])) out[k] = Array.isArray(s) ? s : out[k];
      else if (out[k] && typeof out[k] === "object") out[k] = hydrate(out[k], s);
      else out[k] = s;
    });
    return out;
  }
  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  var store = readStore();
  var songs = hydrate(P.songSeed, store.songs);
  var timeline = hydrate(P.timelineSeed, store.timeline);
  var receipts = store.receipts || {};
  var booking = store.booking || {};

  // Stripe sends the client back with ?paid=true.
  if (new URLSearchParams(location.search).get("paid") === "true" && !booking.paidAt) {
    booking.paidAt = new Date().toISOString();
    store.booking = booking;
    writeStore(store);
    post(AGREEMENT, agreementPayload("paid"));
  }

  var unlocked = P.mode === "overview" || Boolean(booking.paidAt);

  /* ------------------------------------------------------------- helpers */

  function money(n) {
    return (
      "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }
  function money0(n) {
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(id) {
    return document.getElementById(id);
  }
  function when(iso) {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }
  function post(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      if (!r.ok) throw new Error("Server responded " + r.status);
      return r;
    });
  }
  function agreementPayload(action, extra) {
    var o = {
      action: action,
      client: P.client.name,
      contact: P.client.contacts,
      email: P.client.primaryEmail,
      event_date: P.client.eventDate,
      total_fee: current().total,
      deposit: current().deposit,
      package: current().packageName,
    };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  // The selected staffing option, or the single fixed package.
  var chosen = store.option || (P.staffingOptions ? P.staffingOptions.find(function (o) { return o.recommended; }).id : null);
  function current() {
    if (!P.staffingOptions) return P.pricing;
    var o = P.staffingOptions.find(function (x) { return x.id === chosen; }) || P.staffingOptions[0];
    return o.pricing;
  }
  function currentOption() {
    if (!P.staffingOptions) return null;
    return P.staffingOptions.find(function (x) { return x.id === chosen; }) || P.staffingOptions[0];
  }

  /* --------------------------------------------------------- autosave UI */

  var saveTimers = {};
  function queueSave(section, value) {
    var line = el("save-" + section);
    if (line) line.querySelector("em").textContent = "Saving\u2026";
    clearTimeout(saveTimers[section]);
    saveTimers[section] = setTimeout(function () {
      var s = readStore();
      s[section] = value;
      s.receipts = receipts;
      s.booking = booking;
      if (chosen) s.option = chosen;
      var ok = writeStore(s);
      if (line) {
        line.querySelector("em").textContent = ok
          ? "Draft saved on this device"
          : "We could not save to this browser, so keep this tab open";
      }
    }, 400);
  }
  function saveState(section) {
    var r = receipts[section];
    return (
      '<div class="savestate" id="save-' + section + '"><span class="dot"></span>' +
      "<em style=\"font-style:normal\">Draft saved on this device</em>" +
      (r ? "<span>&middot; sent to Ampersound " + esc(when(r.at)) + "</span>" : "") +
      "</div>"
    );
  }

  /* -------------------------------------------------------------- chrome */

  var TABS = [];
  function buildTabs() {
    TABS = [];
    if (P.mode === "proposal") TABS.push({ id: "proposal", label: "Proposal" });
    else TABS.push({ id: "overview", label: "Overview" });
    if (P.playbook) TABS.push({ id: "engagement", label: "Engagement" });
    if (P.vendors && P.vendors.length) TABS.push({ id: "vendors", label: "Vendors" });
    TABS.push({ id: "songs", label: P.labels.songs, lock: true });
    TABS.push({ id: "timeline", label: P.labels.timeline, lock: true });
  }

  var tab = TABS.length ? TABS[0].id : "proposal";
  var step = 0;
  var maxStep = booking.paidAt ? 3 : booking.signedAt ? 2 : 0;

  function lockIcon() {
    return (
      '<svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true" style="flex:none">' +
      '<rect x="0.6" y="4.4" width="7.8" height="6" rx="1.3" stroke="currentColor" stroke-width="1.1"/>' +
      '<path d="M2.5 4.4V3a2 2 0 1 1 4 0v1.4" stroke="currentColor" stroke-width="1.1"/></svg>'
    );
  }

  function renderChrome() {
    var badge = booking.paidAt || P.mode === "overview" ? "Booked" : P.client.badge;
    el("nav").innerHTML =
      '<a class="wordmark" href="https://ampersoundmediagroup.com">Ampersound<span>.</span></a>' +
      '<div class="tabwrap"><div class="tabs" id="tabs">' +
      TABS.map(function (t) {
        var locked = t.lock && !unlocked;
        return (
          '<button type="button" data-tab="' + t.id + '"' +
          (tab === t.id ? ' aria-current="page"' : "") +
          (locked ? " disabled" : "") +
          (locked ? ' title="Unlocks once your booking is confirmed"' : "") +
          ">" + (locked ? lockIcon() : "") + esc(t.label) + "</button>"
        );
      }).join("") +
      "</div></div>" +
      '<span class="badge">' + esc(badge) + "</span>";

    Array.prototype.forEach.call(el("tabs").querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        tab = b.getAttribute("data-tab");
        step = 0;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  /* ---------------------------------------------------------------- rows */

  function row(label, note, value, opts) {
    opts = opts || {};
    return (
      '<div class="row' + (opts.strong ? " strong" : "") + (opts.muted ? " muted" : "") + '">' +
      '<div class="rl"><p>' + esc(label) + "</p>" +
      (note ? "<small>" + esc(note) + "</small>" : "") +
      '</div><p class="rv' + (opts.credit ? " credit" : "") + '">' + esc(value) + "</p></div>"
    );
  }

  /* ------------------------------------------------------ overview mode */

  function viewOverview() {
    var c = P.client, p = P.pricing;
    var h = "";
    h += '<header style="margin-bottom:1.6rem">' +
      '<span class="label" style="letter-spacing:0.22em">Booking confirmed</span>' +
      '<h1 class="page">' + esc(c.name).replace(" &amp; ", ' <em>&amp;</em> ') + "</h1>" +
      '<p class="body" style="margin:0">' + esc(c.eventDateLong) + " &middot; " + esc(c.venue) +
      '<br><span style="color:var(--faint);font-size:0.88rem">' + esc(c.venueDetail) +
      " &middot; " + esc(c.guests) + " guests &middot; " + esc(c.hours) + "</span></p></header>";

    h += '<div class="card"><span class="label">Your package</span>' +
      '<p style="margin:0.55rem 0 0.75rem;font-family:var(--head);font-weight:800;font-size:1.15rem">' +
      esc(c.packageName) + "</p>" +
      '<div class="tags">' + c.services.map(function (s) { return '<span class="tag">' + esc(s) + "</span>"; }).join("") + "</div>" +
      '<ul class="inc">' + c.inclusions.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul></div>";

    h += '<div class="card"><span class="label">Payment</span>';
    if (p.installments) {
      h += '<p class="body" style="margin:0.5rem 0 0.5rem">Four installments of ' +
        money(p.installments[0].amount) + ", total " + money(p.total) + ".</p>";
      h += p.installments.map(function (i) {
        return '<div class="instal"><span class="num">' + i.num + "</span>" +
          "<span>" + money(i.amount) + ' <span style="color:var(--faint)">&middot; due ' + esc(i.due) + "</span></span>" +
          '<span class="st' + (i.status === "Paid" ? " paid" : "") + '">' + esc(i.status) + "</span></div>";
      }).join("");
    } else {
      h += row(p.discountLabel ? c.packageName + " (" + p.discountLabel + ")" : c.packageName, null, money(p.total));
      h += row("Deposit received", null, money(p.deposit), { credit: true });
      if (p.balance > 0) h += row("Balance remaining", p.balanceDue ? "Due " + p.balanceDue : null, money(p.balance), { strong: true });
      else h += row("Paid in full", "Nothing further owed", money(0), { strong: true });
    }
    h += "</div>";

    h += '<div class="card"><span class="label">What we need from you</span>' +
      '<p class="body" style="margin:0.55rem 0 1.1rem">Two things, both on their own tab and both saved as you type. ' +
      "Fill in what you know and leave the rest blank; nothing is final until we lock the plan two weeks out.</p>" +
      '<div class="actions">' +
      '<button class="btn ghost" data-go="songs">' + esc(P.labels.songs) + "</button>" +
      '<button class="btn ghost" data-go="timeline">' + esc(P.labels.timeline) + "</button></div></div>";

    return h;
  }

  /* ------------------------------------------------------ proposal mode */

  function optionCard(o) {
    return (
      '<div class="opt" role="radio" tabindex="0" aria-checked="' + (o.id === chosen) + '" data-opt="' + o.id + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.7rem">' +
      "<div>" +
      '<p class="rec' + (o.recommended ? "" : " blank") + '">What we recommend</p>' +
      '<p class="name">' + esc(o.name) + "</p>" +
      '<p class="crew">' + esc(o.crew) + " &middot; " + esc(o.crewDetail) + "</p>" +
      "</div><span class='pick' aria-hidden='true'><i></i></span></div>" +
      (o.covers
        ? '<div style="display:flex;align-items:baseline;gap:0.5rem;flex-wrap:wrap">' +
          '<span class="frac"' + (o.covers === o.coversOf ? ' style="color:var(--gold)"' : "") + ">" +
          o.covers + " of " + o.coversOf + "</span>" +
          '<span style="font-size:0.82rem;color:var(--faint)">activities you listed, covered by us</span></div>'
        : "") +
      '<p class="body" style="margin:0;font-size:0.87rem">' + esc(o.pitch) + "</p>" +
      (o.gap ? '<p class="gap"><strong style="color:var(--text);font-weight:600">What you cover: </strong>' + esc(o.gap) + "</p>" : "") +
      '<div class="tags">' + o.services.map(function (s) { return '<span class="tag">' + esc(s) + "</span>"; }).join("") + "</div>" +
      '<div class="price"><b>' + money0(o.pricing.total) + "</b><small>all in, travel included</small></div></div>"
    );
  }

  function viewProposal() {
    var c = P.client;
    var o = currentOption();
    var p = current();
    var h = "";

    h += '<header style="margin-bottom:1.6rem">' +
      '<span class="label" style="letter-spacing:0.22em">Proposal for</span>' +
      '<h1 class="page">' + esc(c.name) + "</h1>" +
      '<p class="body" style="margin:0">' + esc(c.eventName || c.packageName) +
      '<br><span style="color:var(--faint);font-size:0.88rem">' + esc(c.eventDateLong) +
      (c.coverageWindow ? " &middot; " + esc(c.coverageWindow) : "") +
      "<br>" + esc(c.venueDetail || c.venue) + "</span></p></header>";

    if (P.heard) {
      h += '<div class="card"><span class="label">' + esc(P.heard.title) + "</span>" +
        P.heard.body.map(function (b) { return '<p class="body" style="margin:0.9rem 0 0">' + esc(b) + "</p>"; }).join("") +
        "</div>";
    }

    if (P.staffingOptions && P.staffingOptions.length > 1) {
      h += '<h2 class="sec">Two ways to <em>staff it</em></h2>';
      h += '<p class="intro">' + esc(P.chooserIntro) + "</p>";
      h += '<div class="options" role="radiogroup" aria-label="Staffing options">' +
        P.staffingOptions.map(optionCard).join("") + "</div>";
    }

    if (P.agendaNeeds) {
      h += '<div class="card"><span class="label" style="margin-bottom:0.6rem">Your five activities, mapped</span>';
      h += P.agendaNeeds.map(function (a) {
        var owner = o.people === 2 ? "Ampersound" : a.mic && a.sound ? "Split" : a.mic ? "Ampersound" : "Your team";
        return '<div class="row"><div class="rl"><p>' + esc(a.item) + "</p>" +
          (owner === "Split" ? "<small>Afia hosts it, your team runs the sound for it</small>" : "") +
          '</div><p class="rv" style="font-size:0.78rem;letter-spacing:0.06em;text-transform:uppercase;color:' +
          (owner === "Ampersound" ? "var(--gold-text)" : "var(--faint)") + '">' + owner + "</p></div>";
      }).join("");
      h += "</div>";
    }

    if (P.runOfShow) {
      var solo = o && o.people === 1;
      h += '<div class="card"><span class="label">The run of show</span>' +
        '<p class="body" style="margin:0.45rem 0 0.4rem;font-size:0.88rem">' + esc(P.runOfShowNote) + "</p>" +
        '<div class="legend"><span><i style="background:var(--gold)"></i>Afia, microphone</span>' +
        "<span><i style=\"" + (solo ? "border:1px dashed var(--faint)" : "background:var(--violet)") + '"></i>' +
        (solo ? "Adam, not on this option" : "Adam, sound") + "</span></div><div>";
      h += P.runOfShow.map(function (m, i) {
        var dim = solo && (m.who === "sound" || m.quiet);
        var bg = m.who === "both"
          ? "linear-gradient(135deg,var(--gold) 50%," + (solo ? "transparent" : "var(--violet)") + " 50%)"
          : m.who === "sound" ? (solo ? "transparent" : "var(--violet)") : "var(--gold)";
        return '<div class="ros"' + (dim ? ' style="opacity:0.45"' : "") + ">" +
          '<p class="t' + (m.quiet ? " q" : "") + '">' + esc(m.time) + "</p>" +
          '<div class="m">' + (i < P.runOfShow.length - 1 ? '<span class="line"></span>' : "") +
          '<span class="dot" style="background:' + bg +
          (m.who === "sound" && solo ? ";border:1px dashed var(--faint)" : "") + '"></span></div>' +
          '<p class="e' + (m.quiet ? " q" : "") + '">' + esc(m.event) +
          (solo && m.who === "sound" && !m.quiet ? ' <span style="color:var(--gold-text);font-size:0.79rem">&middot; your team</span>' : "") +
          "</p></div>";
      }).join("");
      h += "</div></div>";
    }

    /* the quote */
    h += '<div class="card"><span class="label" style="margin-bottom:0.55rem">Services' +
      (o ? " &middot; " + esc(o.name) : "") + "</span>" +
      '<div class="tags" style="margin-bottom:0.75rem">' +
      (o ? o.services : c.services).map(function (s) { return '<span class="tag">' + esc(s) + "</span>"; }).join("") +
      "</div>";
    (p.lines || []).forEach(function (l) {
      h += row(l.label, l.note, l.value === "Included" ? "Included" : money(l.value), { credit: l.credit });
    });
    h += row("Service subtotal", null, money(p.serviceSubtotal), { strong: true }) + "</div>";

    if (p.travel) {
      h += '<div class="card"><span class="label">Travel &middot; at cost</span>' +
        '<p class="body" style="margin:0.45rem 0 0.5rem;font-size:0.85rem;color:var(--faint)">' + esc(p.travel.note) + "</p>";
      p.travel.lines.forEach(function (l) { h += row(l.label, l.note, money(l.value)); });
      h += row("Travel subtotal", null, money(p.travel.subtotal), { strong: true });
      h += '<p class="body" style="margin:0.9rem 0 0;font-size:0.79rem;color:var(--faint)">' + esc(p.travel.footnote) + "</p></div>";
    }

    h += '<div class="total"><span class="label">Total' + (o ? " &middot; " + esc(o.name) : "") + "</span>" +
      '<p class="big">' + money(p.total) + "</p>" +
      '<p style="margin:0.5rem 0 1.15rem;font-size:0.86rem;color:var(--dim)">' + esc(p.totalNote) + "</p>" +
      '<div class="split"><div><p class="k">Deposit to hold the date</p>' +
      '<p class="v gold">' + money(p.deposit) + '</p><p class="n">50%, non-refundable, holds the date</p></div>' +
      '<div><p class="k">Balance</p><p class="v">' + money(p.balance) + "</p>" +
      '<p class="n">Due ' + esc(p.balanceDue) + "</p></div></div></div>";

    if (P.unbundled) {
      var low = P.unbundled.rows.reduce(function (a, u) { return a + u.low; }, 0);
      var high = P.unbundled.rows.reduce(function (a, u) { return a + u.high; }, 0);
      h += '<div class="card"><span class="label">What this costs the other way</span>' +
        '<p class="body" style="margin:0.45rem 0 0.9rem;font-size:0.88rem">' + esc(P.unbundled.intro) + "</p>";
      P.unbundled.rows.forEach(function (u) { h += row(u.role, null, money0(u.low) + " \u2013 " + money0(u.high)); });
      h += row(P.unbundled.totalLabel, null, money0(low) + " \u2013 " + money0(high), { strong: true });
      h += '<div style="margin-top:1.1rem;padding-top:1.1rem;border-top:1px solid var(--line-hot)">' +
        '<p class="body" style="margin:0;font-size:0.88rem">' + P.unbundled.close.replace("{{total}}",
          '<strong style="color:var(--gold-text);font-weight:700">' + money0(P.unbundled.ourTotal) + "</strong>") + "</p>" +
        '<p class="body" style="margin:0.9rem 0 0;font-size:0.88rem">' + esc(P.unbundled.honest) + "</p></div></div>";
    }

    h += '<div class="card"><span class="label">The next step</span>' +
      '<p class="body" style="margin:0.55rem 0 1.1rem">' + esc(P.nextStep.body) + "</p>" +
      '<a class="btn" href="' + esc(P.nextStep.callUrl) + '" target="_blank" rel="noreferrer">' +
      esc(P.nextStep.callLabel) + "</a>" +
      '<p style="margin:0.85rem 0 0;font-size:0.8rem;color:var(--faint);text-align:center">Or just reply to our email: ' +
      '<a href="mailto:afia@ampersoundmediagroup.com">afia@ampersoundmediagroup.com</a></p></div>';

    if (P.agreement) {
      h += '<div class="actions" style="margin-bottom:1.15rem">' +
        '<button class="btn" data-step="1">Read the agreement and sign &rarr;</button></div>';
    }

    h += '<p style="margin:2rem 0 0;font-size:0.8rem;color:var(--faint);line-height:1.7;text-align:center">' +
      esc(P.footnote) + "</p>";
    return h;
  }

  /* ------------------------------------------------- agreement + signing */

  function stepper() {
    var names = ["Quote", "Agreement", "Sign", "Deposit"];
    return '<div class="steps">' + names.map(function (n, i) {
      return '<button type="button" data-step="' + i + '"' +
        (i === step ? ' aria-current="step"' : "") + (i > maxStep ? " disabled" : "") +
        "><i>" + (i < step ? "\u2713" : i + 1) + "</i>" + n + "</button>";
    }).join("") + "</div>";
  }

  function viewAgreement() {
    var p = current();
    var list = P.agreement.clauses.map(function (c) {
      return {
        title: c.title,
        body: c.body
          .replace(/\{\{deposit\}\}/g, money(p.deposit))
          .replace(/\{\{balance\}\}/g, money(p.balance))
          .replace(/\{\{total\}\}/g, money(p.total))
          .replace(/\{\{travel\}\}/g, p.travel ? money(p.travel.subtotal) : "")
          .replace(/\{\{option\}\}/g, currentOption() ? currentOption().name : P.client.packageName),
      };
    });
    var h = stepper();
    h += '<h2 class="sec">The <em>agreement</em></h2>';
    h += '<p class="intro">' + esc(P.agreement.intro) + "</p>";
    h += '<div class="card"><div class="meta3" style="padding-bottom:1.15rem;margin-bottom:0.35rem;border-bottom:1px solid var(--line)">' +
      '<div><span class="k">Between</span><p>Ampersound Media Group LLC</p><p class="d">and ' + esc(P.client.contacts) + "</p></div>" +
      '<div><span class="k">Event</span><p>' + esc(P.client.eventDateLong) + '</p><p class="d">' + esc(P.client.venue) + "</p></div>" +
      '<div><span class="k">Total</span><p>' + money(p.total) + '</p><p class="d">' + money(p.deposit) + " due now</p></div></div>";
    h += '<ol class="clauses">' + list.map(function (c, i) {
      return "<li><span class='n'>" + String(i + 1).padStart(2, "0") + "</span>" +
        '<h3 class="sub">' + esc(c.title) + "</h3><p>" + esc(c.body) + "</p></li>";
    }).join("") + "</ol></div>";
    h += '<div class="actions"><button class="btn ghost" data-step="0">&larr; Quote</button>' +
      '<button class="btn" data-step="2">I have read it, let me sign &rarr;</button></div>';
    return h;
  }

  function viewSign() {
    var h = stepper();
    if (booking.signedAt) {
      h += '<h2 class="sec">Already <em>signed</em></h2>' +
        '<p class="intro">Signed on ' + esc(when(booking.signedAt)) + " by " + esc(booking.signedName) +
        ". Nothing else to do here.</p>" +
        '<button class="btn" data-step="3">Go to the deposit &rarr;</button>';
      return h;
    }
    h += '<h2 class="sec">Your <em>signature</em></h2>';
    h += '<p class="intro">Sign with a mouse, a trackpad, or your finger. This is a legally binding ' +
      "electronic signature, and we email you a copy the moment it lands.</p>";
    h += '<div class="card"><div class="field"><label for="signName">Full legal name</label>' +
      '<input type="text" id="signName" value="' + esc(P.client.signerDefault || "") + '" autocomplete="name"></div>' +
      '<div class="field"><label>Signature</label><div class="sigwrap"><canvas id="sig"></canvas>' +
      '<div class="sigbar"><span>Draw above</span><button type="button" id="sigClear">Clear</button></div></div></div>' +
      '<label class="radio"><input type="checkbox" id="signAgree"><span>I have read the agreement above and ' +
      "I am authorized to sign it on behalf of " + esc(P.client.name) + ".</span></label></div>";
    h += '<div class="actions"><button class="btn ghost" data-step="1">&larr; Agreement</button>' +
      '<button class="btn" id="signSubmit">Sign and continue &rarr;</button></div><div id="signMsg"></div>';
    return h;
  }

  function viewPay() {
    var p = current();
    var h = stepper();
    if (booking.paidAt) {
      h += '<h2 class="sec">You are <em>booked</em></h2>' +
        '<p class="intro">Deposit received ' + esc(when(booking.paidAt)) + ". " + esc(P.client.eventDateLong) +
        " belongs to you. The " + esc(P.labels.songs) + " and " + esc(P.labels.timeline) +
        " tabs are open now, and everything you put there reaches us as you type.</p>" +
        '<div class="actions"><button class="btn ghost" data-go="songs">' + esc(P.labels.songs) + "</button>" +
        '<button class="btn ghost" data-go="timeline">' + esc(P.labels.timeline) + "</button></div>";
      return h;
    }
    h += '<h2 class="sec">The <em>deposit</em></h2>';
    h += '<p class="intro">Your agreement is signed and safe with us. One more step and ' +
      esc(P.client.eventDateLong.replace(/^\w+day, /, "")) + " is officially yours.</p>";
    h += '<div class="card"><span class="label">Due now</span>' +
      '<p class="big" style="font-family:var(--head);font-weight:800;font-size:clamp(2rem,8vw,2.7rem);letter-spacing:-0.035em;margin:0.5rem 0 0.3rem;line-height:1;color:var(--gold)">' +
      money(p.deposit) + "</p>" +
      '<p style="margin:0 0 1.35rem;font-size:0.87rem;color:var(--faint)">50% of ' + money(p.total) +
      " &middot; balance of " + money(p.balance) + " due " + esc(p.balanceDue) + "</p>";
    if (P.paymentLink && P.paymentLink !== "#") {
      h += '<a class="btn" href="' + esc(P.paymentLink) + '">Pay ' + money(p.deposit) + " deposit</a>";
    } else {
      h += '<div style="border:1px dashed var(--line-hot);border-radius:8px;padding:1.1rem 1.2rem;background:var(--raised)">' +
        '<p class="body" style="margin:0">We send a secure Stripe invoice by email rather than storing card ' +
        'details here. Yours is on its way to <span style="color:var(--gold-text)">' + esc(P.client.primaryEmail) +
        "</span>. Pay it from any device and this page updates itself the moment it clears.</p></div>";
    }
    h += '<p style="margin:1.1rem 0 0;font-size:0.8rem;color:var(--faint);line-height:1.65">Card, bank transfer, ' +
      "or check all work. If a payment plan would make this easier, just ask.</p></div>";
    h += '<div class="actions"><button class="btn ghost" data-step="1">&larr; Back to the agreement</button></div>';
    return h;
  }

  /* ------------------------------------------------------------ signature */

  var sigCtx = null, sigInk = false, sigDirty = false;
  function initSig() {
    var cv = el("sig");
    if (!cv) return;
    function size() {
      var r = cv.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      sigCtx = cv.getContext("2d");
      sigCtx.setTransform(1, 0, 0, 1, 0, 0);
      sigCtx.scale(dpr, dpr);
      sigCtx.lineWidth = 2;
      sigCtx.lineCap = "round";
      sigCtx.lineJoin = "round";
      sigCtx.strokeStyle = "#f0ebe4";
    }
    size();
    window.addEventListener("resize", size);
    function pt(e) {
      var r = cv.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function down(e) {
      e.preventDefault();
      sigInk = true; sigDirty = true;
      var p = pt(e);
      sigCtx.beginPath();
      sigCtx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!sigInk) return;
      e.preventDefault();
      var p = pt(e);
      sigCtx.lineTo(p.x, p.y);
      sigCtx.stroke();
    }
    function up(e) {
      if (e) e.preventDefault();
      sigInk = false;
    }
    cv.addEventListener("mousedown", down);
    cv.addEventListener("mousemove", move);
    cv.addEventListener("mouseup", up);
    cv.addEventListener("mouseleave", up);
    cv.addEventListener("touchstart", down, { passive: false });
    cv.addEventListener("touchmove", move, { passive: false });
    cv.addEventListener("touchend", up, { passive: false });
    el("sigClear").addEventListener("click", function () {
      sigCtx.clearRect(0, 0, cv.width, cv.height);
      sigDirty = false;
    });
  }

  function submitSignature() {
    var name = (el("signName").value || "").trim();
    var agreed = el("signAgree").checked;
    var msg = el("signMsg");
    if (!sigDirty || name.length < 2 || !agreed) {
      msg.innerHTML = '<div class="banner bad">We need your full name, a signature, and the ' +
        "confirmation checkbox before we can file this.</div>";
      return;
    }
    var btn = el("signSubmit");
    btn.disabled = true;
    btn.textContent = "Filing\u2026";
    var png = el("sig").toDataURL("image/png");
    post(AGREEMENT, agreementPayload("signed", { signature: png, signedAt: new Date().toISOString(), signerName: name }))
      .then(function () {
        booking.signedAt = new Date().toISOString();
        booking.signedName = name;
        var s = readStore();
        s.booking = booking;
        if (chosen) s.option = chosen;
        writeStore(s);
        maxStep = 3;
        step = 3;
        render();
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Sign and continue \u2192";
        msg.innerHTML = '<div class="banner bad">We could not reach our server just then, so nothing was ' +
          "filed. Your signature is still on screen: please try again in a moment, or email " +
          "afia@ampersoundmediagroup.com and we will handle it by hand.</div>";
      });
  }

  /* ------------------------------------------------------------ planning */

  var VIBES = P.vibes;
  var REQUESTS = P.requests;

  function viewSongs() {
    var h = '<h2 class="sec">' + esc(P.labels.songsHeading) + "</h2>";
    h += '<p class="intro">' + esc(P.labels.songsIntro) + "</p>";
    h += saveState("songs");

    h += '<div class="card"><span class="label" style="margin-bottom:1rem">' + esc(P.labels.momentsHeading) + "</span>";
    h += P.momentFields.map(function (f) {
      return '<div class="field"><label for="m-' + f.key + '">' + esc(f.label) + "</label>" +
        (f.hint ? '<span class="hint">' + esc(f.hint) + "</span>" : "") +
        '<input type="text" id="m-' + f.key + '" data-moment="' + f.key + '" value="' +
        esc(songs.moments[f.key] || "") + '" placeholder="Song title - Artist"></div>';
    }).join("") + "</div>";

    ["mustPlay", "dontPlay"].forEach(function (list) {
      var title = list === "mustPlay" ? "Must-play songs" : "Do not play";
      var ph = list === "mustPlay" ? "Song title - Artist" : "Song, artist, or whole genre";
      h += '<div class="card"><span class="label" style="margin-bottom:0.85rem">' + title + "</span>";
      h += songs[list].map(function (v, i) {
        return '<div class="listrow"><input type="text" data-list="' + list + '" data-i="' + i +
          '" value="' + esc(v) + '" placeholder="' + ph + '">' +
          '<button class="rm" data-rm="' + list + '" data-i="' + i + '" title="Remove row">&times;</button></div>';
      }).join("");
      h += '<button class="addrow" data-add="' + list + '">+ Add song</button></div>';
    });

    h += '<div class="card"><div class="field"><label for="playlist">Existing playlist</label>' +
      '<span class="hint">Spotify, Apple Music, or YouTube link</span>' +
      '<input type="text" id="playlist" value="' + esc(songs.playlist) + '" placeholder="Paste a link"></div></div>';

    h += '<div class="card"><span class="label" style="margin-bottom:0.7rem">Vibe and volume</span>' +
      VIBES.map(function (v) {
        return '<label class="radio"><input type="radio" name="vibe" value="' + v[0] + '"' +
          (songs.vibe === v[0] ? " checked" : "") + "><span>" + esc(v[1]) + "</span></label>";
      }).join("") + "</div>";

    h += '<div class="card"><span class="label" style="margin-bottom:0.7rem">' + esc(P.labels.requestsHeading) + "</span>" +
      REQUESTS.map(function (r) {
        return '<label class="radio"><input type="radio" name="req" value="' + r[0] + '"' +
          (songs.guestRequests === r[0] ? " checked" : "") + "><span>" + esc(r[1]) + "</span></label>";
      }).join("") + "</div>";

    h += '<div class="card"><div class="field"><label for="songNotes">Anything else</label>' +
      '<textarea id="songNotes" placeholder="' + esc(P.labels.songNotesPlaceholder) + '">' +
      esc(songs.notes) + "</textarea></div></div>";

    h += '<button class="btn" id="songsSubmit">' +
      (receipts.songs ? "Send updated " + esc(P.labels.songsNoun) + " to Ampersound" : "Send " + esc(P.labels.songsNoun) + " to Ampersound") +
      "</button><div id=\"songsMsg\"></div>";
    return h;
  }

  function viewTimeline() {
    var h = '<h2 class="sec">' + esc(P.labels.timelineHeading) + "</h2>";
    h += '<p class="intro">' + esc(P.labels.timelineIntro) + "</p>";
    h += saveState("timeline");
    h += '<div class="card"><div class="tlhead"><span class="label">Time</span>' +
      '<span class="label">' + esc(P.labels.momentNoun) + "</span><span></span></div>";
    h += timeline.moments.map(function (m, i) {
      return '<div class="tlrow"><input type="text" data-tl="time" data-i="' + i + '" value="' + esc(m.time) +
        '" placeholder="0:00 PM" aria-label="Time for row ' + (i + 1) + '">' +
        '<input type="text" data-tl="event" data-i="' + i + '" value="' + esc(m.event) +
        '" placeholder="What happens" aria-label="' + esc(P.labels.momentNoun) + " for row " + (i + 1) + '">' +
        '<button class="rm" data-tlrm="' + i + '" title="Remove row">&times;</button></div>';
    }).join("") + "</div>";
    h += '<div style="display:flex;flex-wrap:wrap;gap:0.6rem;margin-bottom:1.15rem">' +
      '<button class="addrow" id="tlAdd">+ Add ' + esc(P.labels.momentNoun.toLowerCase()) + "</button>" +
      '<button class="addrow" id="tlReset">Reset to our draft</button></div>';
    h += '<div class="card"><div class="field"><label for="tlNotes">' + esc(P.labels.timelineNotesLabel) + "</label>" +
      '<textarea id="tlNotes" placeholder="' + esc(P.labels.timelineNotesPlaceholder) + '">' +
      esc(timeline.notes) + "</textarea></div></div>";
    h += '<button class="btn" id="tlSubmit">' +
      (receipts.timeline ? "Send updated " + esc(P.labels.timelineNoun) + " to Ampersound" : "Send " + esc(P.labels.timelineNoun) + " to Ampersound") +
      "</button><div id=\"tlMsg\"></div>";
    return h;
  }

  function viewVendors() {
    var h = '<h2 class="sec">Preferred <em>vendors</em></h2>';
    h += '<p class="intro">People we have worked beside and would hire ourselves. No commission, ' +
      "no obligation, just names we trust.</p>";
    h += P.vendors.map(function (g) {
      return '<div class="card"><span class="label" style="margin-bottom:0.85rem">' + esc(g.group) + "</span>" +
        g.items.map(function (v) {
          return '<div style="padding:0.85rem 0;border-top:1px solid var(--hair)">' +
            '<h3 class="sub">' + esc(v.name) + "</h3>" +
            '<p style="margin:0.2rem 0 0;font-size:0.82rem;color:var(--gold-text)">' + esc(v.role) + "</p>" +
            '<p class="body" style="margin:0.45rem 0 0.5rem;font-size:0.87rem">' + esc(v.blurb) + "</p>" +
            '<div style="display:flex;flex-wrap:wrap;gap:0.9rem">' +
            v.links.map(function (l) {
              return '<a href="' + esc(l.href) + '" style="font-size:0.82rem"' +
                (l.href.indexOf("http") === 0 ? ' target="_blank" rel="noreferrer"' : "") + ">" + esc(l.label) + "</a>";
            }).join("") + "</div></div>";
        }).join("") + "</div>";
    }).join("");
    return h;
  }

  function viewEngagement() {
    var free = P.playbook.filter(function (p) { return p.cost === "Free"; }).length;
    var h = '<h2 class="sec">Engagement <em>recommendations</em></h2>';
    h += '<p class="intro">' + P.playbookIntro.replace("{{free}}", free).replace("{{n}}", P.playbook.length) + "</p>";
    if (P.playbookLead) {
      h += '<div class="card"><span class="label">' + esc(P.playbookLead.title) + "</span>" +
        '<p class="body" style="margin:0.5rem 0 0">' + esc(P.playbookLead.body) + "</p></div>";
    }
    h += '<ol style="list-style:none;margin:0;padding:0">' + P.playbook.map(function (p, i) {
      return '<li style="display:grid;grid-template-columns:2.1rem 1fr;gap:0.35rem 0.7rem;padding:1.35rem 0;' +
        (i === 0 ? "" : "border-top:1px solid var(--line)") + '">' +
        '<span style="font-family:var(--head);font-weight:800;font-size:0.82rem;color:var(--gold-text);padding-top:0.2rem">' +
        String(i + 1).padStart(2, "0") + "</span><div style=\"min-width:0\">" +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.9rem;flex-wrap:wrap">' +
        '<h3 class="sub" style="font-size:1.02rem">' + esc(p.title) + "</h3>" +
        '<span class="tag" style="color:' + (p.cost === "Free" ? "var(--gold-text)" : "var(--faint)") +
        ';border-color:' + (p.cost === "Free" ? "var(--line-hot)" : "var(--line)") + '">' + esc(p.cost) + "</span></div>" +
        '<p class="body" style="margin:0.55rem 0 0;font-size:0.89rem">' + esc(p.body) + "</p></div></li>";
    }).join("") + "</ol>";
    if (P.playbookClose) {
      h += '<div class="card" style="margin-top:1.5rem"><span class="label">' + esc(P.playbookClose.title) + "</span>" +
        '<p class="body" style="margin:0.55rem 0 0">' + P.playbookClose.body + "</p></div>";
    }
    return h;
  }

  function viewLocked(what) {
    return '<div class="locked"><p style="color:var(--gold-text);margin:0 0 0.9rem">' + lockIcon() + "</p>" +
      "<h2>Unlocks once you book</h2><p>Your " + esc(what) + " gets built here, with you, once " +
      esc(P.client.eventDateLong.replace(/^\w+day, /, "")) + " is confirmed. The draft on the first tab " +
      "is our starting point.</p></div>";
  }

  /* -------------------------------------------------------------- submit */

  function sendSongs() {
    var btn = el("songsSubmit"), msg = el("songsMsg");
    btn.disabled = true;
    btn.textContent = "Sending\u2026";
    var clean = function (a) { return a.map(function (x) { return x.trim(); }).filter(Boolean); };
    var vibe = (VIBES.find(function (v) { return v[0] === songs.vibe; }) || [])[1] || songs.vibe;
    var req = (REQUESTS.find(function (r) { return r[0] === songs.guestRequests; }) || [])[1] || songs.guestRequests;
    post(PLANNING, {
      type: "songs",
      email: P.client.primaryEmail,
      emails: P.client.allEmails,
      client: P.client.name,
      data: {
        specialMoments: songs.moments,
        mustPlay: clean(songs.mustPlay),
        dontPlay: clean(songs.dontPlay),
        playlist: songs.playlist,
        vibe: vibe,
        guestRequests: req,
        notes: songs.notes,
      },
    })
      .then(function () {
        receipts.songs = { at: new Date().toISOString() };
        var s = readStore(); s.receipts = receipts; writeStore(s);
        render();
        el("songsMsg").innerHTML = '<div class="banner ok">Got it. Your ' + esc(P.labels.songsNoun) +
          " is on your booking file with Ampersound and both of us can see it. Keep editing any time and send again.</div>";
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Try sending again";
        msg.innerHTML = '<div class="banner bad">We could not reach our server just then. Your answers are ' +
          "still saved in this browser, so try again in a moment.</div>";
      });
  }

  function sendTimeline() {
    var btn = el("tlSubmit"), msg = el("tlMsg");
    btn.disabled = true;
    btn.textContent = "Sending\u2026";
    var moments = timeline.moments.filter(function (m) { return m.time.trim() || m.event.trim(); });
    post(PLANNING, {
      type: "timeline",
      email: P.client.primaryEmail,
      emails: P.client.allEmails,
      client: P.client.name,
      data: { moments: moments, notes: timeline.notes },
    })
      .then(function () {
        receipts.timeline = { at: new Date().toISOString() };
        var s = readStore(); s.receipts = receipts; writeStore(s);
        render();
        el("tlMsg").innerHTML = '<div class="banner ok">' + esc(P.labels.timelineNoun.charAt(0).toUpperCase() +
          P.labels.timelineNoun.slice(1)) + " received and on your booking file. We confirm the final version " +
          "two weeks out, so keep sending changes until then.</div>";
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Try sending again";
        msg.innerHTML = '<div class="banner bad">We could not reach our server just then. Your draft is still ' +
          "saved in this browser, so try again in a moment.</div>";
      });
  }

  /* -------------------------------------------------------------- render */

  function render() {
    buildTabs();
    if (!TABS.some(function (t) { return t.id === tab; })) tab = TABS[0].id;
    renderChrome();
    var m = el("main");

    if (tab === "overview") m.innerHTML = viewOverview();
    else if (tab === "proposal") {
      m.innerHTML = step === 0 ? viewProposal() : step === 1 ? viewAgreement() : step === 2 ? viewSign() : viewPay();
    } else if (tab === "engagement") m.innerHTML = viewEngagement();
    else if (tab === "vendors") m.innerHTML = viewVendors();
    else if (tab === "songs") m.innerHTML = unlocked ? viewSongs() : viewLocked(P.labels.songsNoun);
    else if (tab === "timeline") m.innerHTML = unlocked ? viewTimeline() : viewLocked(P.labels.timelineNoun);

    wire();
    if (tab === "proposal" && step === 2 && !booking.signedAt) setTimeout(initSig, 50);
  }

  function wire() {
    var m = el("main");

    // step + tab navigation
    Array.prototype.forEach.call(m.querySelectorAll("[data-step]"), function (b) {
      b.addEventListener("click", function () {
        var n = Number(b.getAttribute("data-step"));
        if (n > maxStep) return;
        step = n;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    Array.prototype.forEach.call(m.querySelectorAll("[data-go]"), function (b) {
      b.addEventListener("click", function () {
        tab = b.getAttribute("data-go");
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    // staffing option chooser
    Array.prototype.forEach.call(m.querySelectorAll("[data-opt]"), function (c) {
      function pick() {
        chosen = c.getAttribute("data-opt");
        var s = readStore(); s.option = chosen; writeStore(s);
        render();
      }
      c.addEventListener("click", pick);
      c.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      });
    });

    // songs
    Array.prototype.forEach.call(m.querySelectorAll("[data-moment]"), function (i) {
      i.addEventListener("input", function () {
        songs.moments[i.getAttribute("data-moment")] = i.value;
        queueSave("songs", songs);
      });
    });
    Array.prototype.forEach.call(m.querySelectorAll("[data-list]"), function (i) {
      i.addEventListener("input", function () {
        songs[i.getAttribute("data-list")][Number(i.getAttribute("data-i"))] = i.value;
        queueSave("songs", songs);
      });
    });
    Array.prototype.forEach.call(m.querySelectorAll("[data-rm]"), function (b) {
      b.addEventListener("click", function () {
        var l = b.getAttribute("data-rm");
        songs[l].splice(Number(b.getAttribute("data-i")), 1);
        if (!songs[l].length) songs[l] = [""];
        queueSave("songs", songs);
        render();
      });
    });
    Array.prototype.forEach.call(m.querySelectorAll("[data-add]"), function (b) {
      b.addEventListener("click", function () {
        songs[b.getAttribute("data-add")].push("");
        queueSave("songs", songs);
        render();
      });
    });
    if (el("playlist")) el("playlist").addEventListener("input", function () {
      songs.playlist = this.value; queueSave("songs", songs);
    });
    if (el("songNotes")) el("songNotes").addEventListener("input", function () {
      songs.notes = this.value; queueSave("songs", songs);
    });
    Array.prototype.forEach.call(m.querySelectorAll('input[name=vibe]'), function (r) {
      r.addEventListener("change", function () { songs.vibe = r.value; queueSave("songs", songs); });
    });
    Array.prototype.forEach.call(m.querySelectorAll('input[name=req]'), function (r) {
      r.addEventListener("change", function () { songs.guestRequests = r.value; queueSave("songs", songs); });
    });
    if (el("songsSubmit")) el("songsSubmit").addEventListener("click", sendSongs);

    // timeline
    Array.prototype.forEach.call(m.querySelectorAll("[data-tl]"), function (i) {
      i.addEventListener("input", function () {
        timeline.moments[Number(i.getAttribute("data-i"))][i.getAttribute("data-tl")] = i.value;
        queueSave("timeline", timeline);
      });
    });
    Array.prototype.forEach.call(m.querySelectorAll("[data-tlrm]"), function (b) {
      b.addEventListener("click", function () {
        timeline.moments.splice(Number(b.getAttribute("data-tlrm")), 1);
        if (!timeline.moments.length) timeline.moments = [{ time: "", event: "" }];
        queueSave("timeline", timeline);
        render();
      });
    });
    if (el("tlAdd")) el("tlAdd").addEventListener("click", function () {
      timeline.moments.push({ time: "", event: "" });
      queueSave("timeline", timeline);
      render();
    });
    if (el("tlReset")) el("tlReset").addEventListener("click", function () {
      timeline = clone(P.timelineSeed);
      queueSave("timeline", timeline);
      render();
    });
    if (el("tlNotes")) el("tlNotes").addEventListener("input", function () {
      timeline.notes = this.value; queueSave("timeline", timeline);
    });
    if (el("tlSubmit")) el("tlSubmit").addEventListener("click", sendTimeline);

    // signature
    if (el("signSubmit")) el("signSubmit").addEventListener("click", submitSignature);
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.title = P.client.name + " | Ampersound Media Group";
    render();
    // Tell the backend the client opened their portal. Fire and forget: a
    // failed ping must never block the page.
    if (P.mode === "proposal" && !booking.viewedAt) {
      booking.viewedAt = new Date().toISOString();
      var s = readStore(); s.booking = booking; writeStore(s);
      post(AGREEMENT, agreementPayload("viewed")).catch(function () {});
    }
  });
})();
