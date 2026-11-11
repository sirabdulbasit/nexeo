// Applies the saved theme before the first paint so a light-theme user never sees a
// dark flash on load. Kept in sync with src/context/ThemeContext.jsx (same key, same
// values). Dark is the default; 'system' follows the operating system.
(function () {
  var pref = 'dark';
  try { pref = localStorage.getItem('nexeo:theme') || 'dark'; } catch (e) { /* storage blocked */ }
  var theme = pref;
  if (pref === 'system') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
})();
