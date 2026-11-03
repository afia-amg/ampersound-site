/* Shared, progressive keyboard support. No requests, signatures or payments run here. */
(function (root) {
  'use strict';
  function validTyped(name, consent) { return typeof name === 'string' && name.trim().length >= 2 && consent === true; }
  function mountSignature(cv) {
    if (cv._amgSignature) return cv._amgSignature;
    var d = cv.ownerDocument, id = 'amg-' + cv.id, box = d.createElement('fieldset');
    box.className = 'amg-signature';
    box.innerHTML = '<legend>Signature method</legend><label><input type="radio" name="' + id + '-method" value="draw" checked> Draw signature</label><label><input type="radio" name="' + id + '-method" value="type"> Type signature (keyboard accessible)</label><div class="amg-typed" hidden><label for="' + id + '-name">Full legal name for your signature</label><input type="text" id="' + id + '-name" autocomplete="name" maxlength="160"><label><input type="checkbox" id="' + id + '-consent"> I intend this typed name to be my electronic signature, accept the agreement, and am authorized to sign it.</label><p>Your signature is recorded only when you activate the agreement signing button and the server accepts it.</p></div><p id="' + id + '-error" class="amg-error" role="alert"></p>';
    var wrap = cv.parentElement;
    wrap.before(box);
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Optional drawn signature. Choose Type signature above to sign with a keyboard.');
    var controls = {
      box: box, wrap: wrap, name: box.querySelector('input[type=text]'),
      consent: box.querySelector('input[type=checkbox]'), error: box.querySelector('.amg-error'),
      typed: function () { return box.querySelector('input[value=type]').checked; }
    };
    controls.name.setAttribute('aria-describedby', id + '-error');
    box.addEventListener('change', function () {
      var typed = controls.typed();
      box.querySelector('.amg-typed').hidden = !typed;
      wrap.hidden = typed;
      controls.error.textContent = '';
    });
    cv._amgSignature = controls;
    return controls;
  }
  function signature(cv, drawn) {
    var c = mountSignature(cv);
    if (!c.typed()) {
      if (!drawn) { c.error.textContent = 'Draw a signature, or choose Type signature to use your keyboard.'; c.box.querySelector('input[value=type]').focus(); return { ok: false }; }
      return { ok: true, method: 'drawn', name: '', image: cv.toDataURL('image/png') };
    }
    if (!validTyped(c.name.value, c.consent.checked)) {
      c.error.textContent = 'Enter your full legal name and check the electronic-signature consent box.';
      c.name.setAttribute('aria-invalid', String(c.name.value.trim().length < 2));
      (c.name.value.trim().length < 2 ? c.name : c.consent).focus();
      return { ok: false };
    }
    c.name.removeAttribute('aria-invalid');
    var name = c.name.value.trim(), png = cv.ownerDocument.createElement('canvas');
    png.width = 1400; png.height = 180;
    var ctx = png.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, png.width, png.height);
    ctx.fillStyle = '#111111'; ctx.font = '32px sans-serif';
    ctx.fillText(name, 24, 70, 1340);
    ctx.font = '18px sans-serif';
    ctx.fillText('Electronic signature: typed name, with explicit consent', 24, 116);
    return { ok: true, method: 'typed', name: name, image: png.toDataURL('image/png') };
  }
  var api = { validTyped: validTyped, mountSignature: mountSignature, signature: signature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.AMGForms = api;
  var d = root.document, seq = 0, scheduled = false, lastFocus = null, messages = new WeakMap();
  var announcer = d.createElement('div');
  announcer.setAttribute('role','status'); announcer.setAttribute('aria-live','polite'); announcer.setAttribute('aria-atomic','true');
  announcer.style.cssText='position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  d.body.appendChild(announcer);
  var css = d.createElement('style');
  css.textContent = '[hidden]{display:none!important}:is(input,select,textarea,button,a,[tabindex]):focus-visible{outline:3px solid #c9a96e!important;outline-offset:3px!important}.svc-check input:focus-visible+label{outline:3px solid #c9a96e;outline-offset:3px}.amg-signature{border:1px solid #c9a96e55;border-radius:8px;padding:16px;margin:16px 0;min-width:0}.amg-signature legend{font-weight:700}.amg-signature label{display:block!important;margin:10px 0!important;font-size:14px!important;letter-spacing:normal!important;text-transform:none!important;color:inherit!important}.amg-signature input[type=radio],.amg-signature input[type=checkbox]{appearance:auto!important;position:static!important;opacity:1!important;width:18px!important;height:18px!important;display:inline-block!important;margin:0 8px 0 0!important;clip-path:none!important}.amg-signature input[type=text]{width:100%;padding:12px;background:#0f1114;color:#f0ebe4;border:1px solid #c9a96e;border-radius:6px}.amg-signature p{font-size:13px}.amg-error{color:#ffa9a9}.amg-signature+div[hidden]{display:none!important}';
  d.head.appendChild(css);
  function ensureId(node) { if (!node.id) node.id = 'amg-field-' + (++seq); return node.id; }
  function addDescription(field, id) {
    var ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (ids.indexOf(id) < 0) { ids.push(id); field.setAttribute('aria-describedby', ids.join(' ')); }
  }
  function enhance() {
    scheduled = false;
    d.querySelectorAll('.form-group,.field').forEach(function (group) {
      var label = group.querySelector('label:not([for])'), field = group.querySelector('input:not([type=hidden]),select,textarea');
      if (label && field && !label.contains(field) && !field.closest('.star-rating')) label.htmlFor = ensureId(field);
    });
    d.querySelectorAll('input[data-list]').forEach(function (field) {
      if (!field.hasAttribute('aria-label')) field.setAttribute('aria-label', (field.dataset.list === 'mustPlay' ? 'Must-play song' : 'Do-not-play song or artist') + ', row ' + (Number(field.dataset.i) + 1));
    });
    d.querySelectorAll('#sig,#sigCanvas').forEach(function (cv) { if (cv.tagName === 'CANVAS') mountSignature(cv); });
    d.querySelectorAll('#lookupError,#statusMsg,#signMsg,#songsMsg,#tlMsg,#reviewMsg,#signedMsg,#intakeSuccess,.success-msg').forEach(function (msg) {
      if (!msg.hasAttribute('aria-live')) msg.setAttribute('aria-live', 'polite');
      if (!msg.hasAttribute('role')) msg.setAttribute('role', 'status');
      if (!msg.hasAttribute('aria-atomic')) msg.setAttribute('aria-atomic', 'true');
      var content = msg.textContent.trim();
      if (content && msg.getClientRects().length && messages.get(msg) !== content) {
        messages.set(msg,content);
        if (announcer.textContent !== content) announcer.textContent = content;
      }
      if ((msg.id === 'intakeSuccess' || msg.id === 'testimonialSuccess') && msg.classList.contains('visible') && !msg.dataset.amgFocused) {
        msg.dataset.amgFocused='true';msg.tabIndex=-1;msg.focus();
      }
      if (msg.id === 'lookupError') {
        var field = d.getElementById('lookupEmail');
        if (field) { addDescription(field, msg.id); field.setAttribute('aria-invalid', String(field.classList.contains('invalid'))); }
      }
      if (msg.id === 'signMsg') {
        ['signName','signAgree'].forEach(function (id) { var f = d.getElementById(id); if (f) addDescription(f, msg.id); });
      }
    });
    d.querySelectorAll('.banner.bad').forEach(function (msg) { if (msg.getAttribute('role') !== 'alert') msg.setAttribute('role', 'alert'); });
    d.querySelectorAll('.terms-toggle').forEach(function (toggle) {
      if (!toggle.hasAttribute('role')) toggle.setAttribute('role', 'button');
      if (!toggle.hasAttribute('tabindex')) toggle.tabIndex = 0;
      var expanded = String(toggle.classList.contains('open'));
      if (toggle.getAttribute('aria-expanded') !== expanded) toggle.setAttribute('aria-expanded', expanded);
      if (toggle.nextElementSibling && !toggle.hasAttribute('aria-controls')) toggle.setAttribute('aria-controls', ensureId(toggle.nextElementSibling));
    });
    d.querySelectorAll('[role=radiogroup]').forEach(function (group) {
      var radios = Array.from(group.querySelectorAll('[role=radio]')), selected = radios.find(function (r) { return r.getAttribute('aria-checked') === 'true'; }) || radios[0];
      radios.forEach(function (r) { var tab = r === selected ? 0 : -1; if (r.tabIndex !== tab) r.tabIndex = tab; });
    });
    // A view render may replace a focused staffing card. Restore its replacement.
    if (lastFocus && !lastFocus.isConnected && lastFocus.dataset && lastFocus.dataset.opt) {
      var option = Array.from(d.querySelectorAll('[data-opt]')).find(function (r) { return r.dataset.opt === lastFocus.dataset.opt; });
      if (option) { option.focus(); lastFocus = option; }
    }
    var results = d.getElementById('resultsSection'), title = d.getElementById('resultsTitle');
    if (results && results.classList.contains('visible') && title && !results.dataset.amgFocused) {
      results.dataset.amgFocused = 'true'; title.tabIndex = -1; title.focus();
    } else if (results && !results.classList.contains('visible') && results.dataset.amgFocused) {
      delete results.dataset.amgFocused; var email = d.getElementById('lookupEmail'); if (email) email.focus();
    }
    var overlay = d.getElementById('successOverlay');
    if (overlay && overlay.classList.contains('visible') && !overlay.dataset.amgFocused) {
      overlay.dataset.amgFocused = 'true'; overlay.tabIndex = -1; overlay.setAttribute('role','region'); overlay.setAttribute('aria-label','Agreement submission result'); overlay.focus();
    }
  }
  d.addEventListener('focusin', function (e) { lastFocus = e.target; });
  d.addEventListener('keydown', function (e) {
    var toggle = e.target.closest('.terms-toggle');
    if (toggle && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle.click(); return; }
    var radio = e.target.closest('[role=radio][data-opt]'), group = radio && radio.closest('[role=radiogroup]');
    if (!group || !['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var radios = Array.from(group.querySelectorAll('[role=radio]')), i = radios.indexOf(radio);
    var next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + radios.length) % radios.length;
    var id = radios[next].dataset.opt;
    radios[next].click();
    var replacement = Array.from(d.querySelectorAll('[data-opt]')).find(function (r) { return r.dataset.opt === id; });
    if (replacement) replacement.focus();
  }, true);
  new MutationObserver(function () { if (!scheduled) { scheduled = true; queueMicrotask(enhance); } }).observe(d.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  enhance();
})(typeof window === 'undefined' ? null : window);
