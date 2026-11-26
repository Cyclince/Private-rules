import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isTelegramMiniApp } from '../lib/telegram/webapp';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'private-rules-theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  if (typeof document !== 'undefined') {
    const preset = document.documentElement.dataset.theme;
    if (preset === 'dark' || preset === 'light') return preset;
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage errors.
  }
  return 'dark';
}

function applyThemeToDocument(theme: Theme, animate: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
  }
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#0b1418' : '#f5fafa');
  }
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initialTheme }: { children: ReactNode; initialTheme?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(() => initialTheme ?? readInitialTheme());
  const transitionTimer = useRef<number | null>(null);
  const mounted = useRef(false);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  useEffect(() => {
    if (isTelegramMiniApp()) {
      let active = true;
      void import('../lib/telegram/theme').then(({ applyTelegramTheme }) => {
        if (!active) return;
        const applied = applyTelegramTheme();
        if (applied) {
          setThemeState(applied);
          mounted.current = true;
        }
      });
      return () => {
        active = false;
      };
    }
    const animate = mounted.current;
    mounted.current = true;
    applyThemeToDocument(theme, animate);
    if (animate && typeof window !== 'undefined') {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(() => {
        document.documentElement.classList.remove('theme-transition');
      }, 220);
    }
  }, [theme]);

  useEffect(() => {
    return () => {
      if (transitionTimer.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(transitionTimer.current);
      }
    };
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context;
}
