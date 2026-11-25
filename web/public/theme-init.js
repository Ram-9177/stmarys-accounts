// Sets the theme before first paint, so someone who chose dark never sees a
// flash of the light palette. A file, not inline, so the page runs under a
// strict Content-Security-Policy (script-src 'self'). Same key and states as
// the UOS shell (uos-auth-ui): 'light' (the default), 'dark', or 'system',
// which writes no attribute and lets prefers-color-scheme decide. Keep in step
// with src/lib/theme.ts.
(function () {
  try {
    var t = localStorage.getItem('uos-theme') || 'light';
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {
    /* Private mode or blocked storage: fall through to prefers-color-scheme. */
  }
})();
