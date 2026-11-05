/* Cue Sheet offline shell. Keeps the vendor page, room console and their assets on the phone, so a
   private link still opens with no signal. Live data never comes from here: the pages fetch it fresh
   and fall back to the copy they saved themselves, clearly marked as offline. */
const CACHE = 'cue-shell-v1';
const SHELL = ['/cue/vendor.html', '/cue/control.html', '/cue/_assets/cue.css', '/cue/_assets/cue-core.js', '/cue/_assets/vendor.js', '/cue/_assets/control.js', '/cue/_assets/room.js'];
const EXTRA = ['https://lh3.googleusercontent.com/d/1EVb28hX3L68EwR2jVu7703wRA_3dN3co'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await Promise.all(EXTRA.map((u) => fetch(u, { mode: 'no-cors' }).then((r) => c.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('cue-shell-')) await caches.delete(k);
    await self.clients.claim();
  })());
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/.netlify/')) return;
  // Pages: network first, then the saved shell for that kind of link.
  if (req.mode === 'navigate' && url.origin === location.origin && url.pathname.startsWith('/cue/')) {
    const shell = /\/(control|room)(\/|$)/.test(url.pathname) ? '/cue/control.html' : '/cue/vendor.html';
    e.respondWith((async () => {
      try {
        const r = await withTimeout(fetch(req), 5000);
        if (r.ok) { const c = await caches.open(CACHE); c.put(shell, r.clone()); }
        return r;
      } catch (_) { return (await caches.match(shell)) || Response.error(); }
    })());
    return;
  }
  // App files: network first (so a deploy is never one load behind), the saved copy when there's no signal.
  // Fonts and the logo: the saved copy right away, refreshed in the background.
  const mine = url.origin === location.origin && url.pathname.startsWith('/cue/_assets/');
  const fonts = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|lh3\.googleusercontent\.com)$/.test(url.hostname);
  if (!mine && !fonts) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (mine) {
      try { const r = await withTimeout(fetch(req), 4000); if (r.ok) c.put(req, r.clone()); return r; }
      catch (_) { return (await c.match(req, { ignoreSearch: true })) || Response.error(); }
    }
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});
