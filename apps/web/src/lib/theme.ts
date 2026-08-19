import { useEffect, useState } from 'react';

/**
 * Theme clair ou sombre. Le choix est stocke localement; sans choix explicite,
 * on suit la préférence du système.
 */

type Theme = 'light' | 'dark';
const KEY = 'removebroker.theme';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) ?? systemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (localStorage.getItem(KEY)) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(systemTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return {
    theme,
    toggle() {
      const next: Theme = theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(KEY, next);
      setTheme(next);
    },
  };
}

/** Applique le theme avant le premier rendu pour éviter un flash blanc. */
export function initTheme(): void {
  applyTheme((localStorage.getItem(KEY) as Theme) ?? systemTheme());
}
