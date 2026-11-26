import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ErrorCode } from '../../shared/errors';
import { zhCN, type MessageKey, type Messages } from './zh-CN';

export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = 'private-rules-locale';

const loadedDictionaries: Partial<Record<Locale, Messages>> = {
  'zh-CN': zhCN,
};

export async function loadLocaleDictionary(locale: Locale): Promise<Messages> {
  const cached = loadedDictionaries[locale];
  if (cached) return cached;
  if (locale === 'zh-TW') {
    const mod = await import('./zh-TW');
    loadedDictionaries['zh-TW'] = mod.zhTW;
    return mod.zhTW;
  }
  if (locale === 'en') {
    const mod = await import('./en');
    loadedDictionaries.en = mod.en;
    return mod.en;
  }
  return zhCN;
}

export function resolveLocale(raw?: string | null): Locale {
  if (!raw) return 'zh-CN';
  const normalized = raw.trim().toLowerCase();
  if (normalized.startsWith('en')) return 'en';
  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.includes('hant')) {
    return 'zh-TW';
  }
  return 'zh-CN';
}

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return resolveLocale(saved);
  } catch {
    // Ignore storage failures in restricted contexts.
  }
  return resolveLocale(window.navigator?.language);
}

export function getDictionary(locale: Locale): Messages {
  return loadedDictionaries[locale] ?? zhCN;
}

export function translateErrorCode(code: ErrorCode, locale: Locale = 'zh-CN'): string {
  const dict = getDictionary(locale);
  const key = `error.${code}` as MessageKey;
  return dict[key] ?? dict['error.INTERNAL'];
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
  tError: (code: ErrorCode) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readInitialLocale());
  const [dict, setDict] = useState<Messages>(() => getDictionary(initialLocale ?? readInitialLocale()));

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    const cached = loadedDictionaries[next];
    if (cached) setDict(cached);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
    void loadLocaleDictionary(locale).then((loaded) => {
      if (active) setDict(loaded);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => dict[key],
      tError: (code) => {
        const key = `error.${code}` as MessageKey;
        return dict[key] ?? dict['error.INTERNAL'];
      },
    }),
    [locale, setLocale, dict],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside <I18nProvider>');
  }
  return context;
}

export type { MessageKey, Messages };
