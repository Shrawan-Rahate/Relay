// Blocking head script: apply the theme before CSS and React can paint.
(() => {
  const key = 'relay-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  const readPreference = () => {
    try {
      const value = window.localStorage.getItem(key);
      return value === 'light' || value === 'dark' ? value : null;
    } catch { return null; }
  };
  let preference = readPreference();
  let theme;
  const apply = () => {
    const next = preference || (media.matches ? 'dark' : 'light');
    if (next === theme) return;
    theme = next;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#141519' : '#FAF7F2';
    listeners.forEach(listener => listener());
  };
  window.relayTheme = {
    getSnapshot: () => theme,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle: () => {
      preference = theme === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(key, preference); } catch { /* Keep working in memory. */ }
      apply();
    },
  };
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = readPreference();
      apply();
    }
  });
  apply();
})();
