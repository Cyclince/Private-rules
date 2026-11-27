import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '../lib/reduced-motion';
import { isTelegramMiniApp } from '../lib/telegram/webapp';

/**
 * Theme switching can use a View Transition once the helper chunk arrives; until
 * then (and in browsers without support) the CSS property transition fallback runs.
 * Loading it lazily keeps `motion.ts` out of the first-screen bundle.
 */
type ThemeTransitionStarter = (update: () => void) => boolean;
let startThemeViewTransition: ThemeTransitionStarter | null = null;
if (typeof window !== 'undefined') {
  void import('../lib/motion')
    .then((motion) => {
      startThemeViewTransition = motion.startThemeViewTransition;
    })
    .catch(() => undefined);
}

export type Theme = 'dark' | 'light';
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'private-rules-theme';

function getSystemTheme(): Theme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  }
  return 'dark';
}

function readInitialThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore storage errors.
  }
  return 'system';
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
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initialTheme }: { children: ReactNode; initialTheme?: ThemePreference }) {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    () => initialTheme ?? readInitialThemePreference(),
  );
  const [systemTheme, setSystemTheme] = useState<Theme>(() => getSystemTheme());
  const [telegramTheme, setTelegramTheme] = useState<Theme | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const mounted = useRef(false);

  const theme: Theme = telegramTheme ?? (themePreference === 'system' ? systemTheme : themePreference);

  const setThemePreference = useCallback((next: ThemePreference) => {
    setThemePreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemePreference(next);
    },
    [setThemePreference],
  );

  const toggleTheme = useCallback(() => {
    setThemePreference(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setThemePreference]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      setSystemTheme(getSystemTheme());
    };
    handleChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (isTelegramMiniApp()) {
      let active = true;
      void import('../lib/telegram/theme').then(({ applyTelegramTheme }) => {
        if (!active) return;
        const applied = applyTelegramTheme();
        if (applied) {
          setTelegramTheme(applied);
          mounted.current = true;
        }
      });
      return () => {
        active = false;
      };
    }
    const animate = mounted.current;
    mounted.current = true;
    // M4a: cross-fade the whole page's colors with a View Transition when possible,
    // otherwise keep the property-level theme-transition fallback.
    if (
      animate &&
      !prefersReducedMotion() &&
      startThemeViewTransition &&
      startThemeViewTransition(() => {
        document.documentElement.classList.remove('theme-transition');
        applyThemeToDocument(theme, false);
      })
    ) {
      if (transitionTimer.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(transitionTimer.current);
        transitionTimer.current = null;
      }
      return;
    }
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

  const value = useMemo(
    () => ({ theme, themePreference, setThemePreference, setTheme, toggleTheme }),
    [theme, themePreference, setThemePreference, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context;
}
