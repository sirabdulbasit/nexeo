import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Theme — dark (default), light, or follow the operating system.
 *
 * The choice is saved per browser under `nexeo:theme` and applied as
 * <html data-theme="dark|light">. public/theme-init.js applies the same value
 * before React loads, so the page never flashes the wrong theme.
 */
const STORAGE_KEY = 'nexeo:theme';
const PREFS = ['dark', 'light', 'system'];

function readPref() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return PREFS.includes(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

const systemQuery = () =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

function resolve(pref) {
  if (pref === 'system') return systemQuery()?.matches ? 'light' : 'dark';
  return pref;
}

const ThemeContext = createContext({ preference: 'dark', theme: 'dark', setPreference: () => {} });

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPref);
  const [theme, setTheme] = useState(() => resolve(readPref()));

  useEffect(() => {
    const apply = () => {
      const t = resolve(preference);
      setTheme(t);
      document.documentElement.setAttribute('data-theme', t);
    };
    apply();
    if (preference !== 'system') return undefined;
    const mq = systemQuery();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [preference]);

  const setPreference = useCallback((p) => {
    if (!PREFS.includes(p)) return;
    try { localStorage.setItem(STORAGE_KEY, p); } catch { /* storage blocked: applies for this visit only */ }
    setPreferenceState(p);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, theme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
