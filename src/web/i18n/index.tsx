import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ErrorCode } from '../../shared/errors';
import type { MessageKey, Messages } from './zh-CN';
import { zhCNCore } from './zh-CN.core';

export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = 'private-rules-locale';

const zhCNMerged: Partial<Messages> = { ...zhCNCore };
let zhCNPagesLoaded = false;

const loadedDictionaries: Partial<Record<Locale, Partial<Messages>>> = {
  'zh-CN': zhCNMerged,
};

const dictListeners = new Set<() => void>();

function notifyDictionaryUpdated() {
  for (const listener of dictListeners) listener();
}

export async function loadPageTranslations(): Promise<void> {
  if (zhCNPagesLoaded) return;
  const mod = await import('./zh-CN.pages');
  Object.assign(zhCNMerged, mod.zhCNPages);
  zhCNPagesLoaded = true;
  notifyDictionaryUpdated();
}

export async function loadLocaleDictionary(locale: Locale): Promise<Messages> {
  if (locale === 'zh-CN') {
    await loadPageTranslations();
    return zhCNMerged as Messages;
  }
  const cached = loadedDictionaries[locale];
  if (cached) return cached as Messages;
  if (locale === 'zh-TW') {
    const mod = await import('./zh-TW');
    loadedDictionaries['zh-TW'] = mod.zhTW;
    notifyDictionaryUpdated();
    return mod.zhTW;
  }
  if (locale === 'en') {
    const mod = await import('./en');
    loadedDictionaries.en = mod.en;
    notifyDictionaryUpdated();
    return mod.en;
  }
  return zhCNMerged as Messages;
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
  return (loadedDictionaries[locale] ?? zhCNMerged) as Messages;
}

export function translateErrorCode(code: ErrorCode, locale: Locale = 'zh-CN'): string {
  const dict = getDictionary(locale);
  const key = `error.${code}` as MessageKey;
  return dict[key] ?? dict['error.INTERNAL'] ?? code;
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
  const [version, setVersion] = useState(0);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    dictListeners.add(onUpdate);
    return () => {
      dictListeners.delete(onUpdate);
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
    if (locale !== 'zh-CN') {
      void loadLocaleDictionary(locale);
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const dict = getDictionary(locale);
    return {
      locale,
      setLocale,
      t: (key) => dict[key] ?? zhCNMerged[key] ?? key,
      tError: (code) => {
        const key = `error.${code}` as MessageKey;
        return dict[key] ?? dict['error.INTERNAL'] ?? code;
      },
    };
  }, [locale, setLocale, version]);

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
