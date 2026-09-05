// Theme boot (docs/IDENTITY_DECISIONS_2026-09-03.md Q1). Loaded before
// hydration from app/layout.tsx so a saved theme never flashes. Keep in sync
// with app/lib/theme.tsx: STORAGE_KEY, LIGHT_GROUND, DARK_GROUND, QUERY.
(function () {
  try {
    var v = localStorage.getItem('reel.theme');
    var d = document.documentElement;
    if (v === 'light' || v === 'dark') d.setAttribute('data-theme', v);
    else d.removeAttribute('data-theme');
    var dark = v === 'dark' || (v !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    m.setAttribute('content', dark ? '#06070f' : '#f4f4fa');
  } catch (e) {
    // No storage or no matchMedia: the CSS falls back to the system scheme.
  }
})();
