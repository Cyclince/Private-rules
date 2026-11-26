import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Globe, Lock, Moon, ShieldAlert, Sun } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import aboutEmblemUrl from '../assets/miku-about-emblem.webp';
import loginBgUrl from '../assets/miku-login-bg.webp';
import { loadPageTranslations, SUPPORTED_LOCALES, useI18n, type Locale } from '../i18n';
import { api, ApiClientError, readApiJson } from '../lib/api';
import { ensureAuthenticatedSession } from '../lib/auth-guard';
import { authMeQueryOptions, invalidateAuth } from '../lib/query-core';
import { useTheme } from '../theme/ThemeProvider';

const LOCKOUT_STORAGE_KEY = 'private-rules-login-lock-until';
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

type LoginSearch = {
  redirect?: string;
};

function sanitizeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/login')) {
    return undefined;
  }
  return trimmed;
}

function readLockoutRemainingSeconds(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(LOCKOUT_STORAGE_KEY);
    if (!raw) return 0;
    const until = Number(raw);
    if (!Number.isFinite(until)) return 0;
    const remaining = Math.ceil((until - Date.now()) / 1000);
    if (remaining <= 0) {
      window.sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
      return 0;
    }
    return remaining;
  } catch {
    return 0;
  }
}

function writeLockoutUntil(untilMs: number) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LOCKOUT_STORAGE_KEY, String(untilMs));
  } catch {
    // Ignore storage errors.
  }
}

function clearLockout() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const target = sanitizeRedirect(search.redirect);
    return target ? { redirect: target } : {};
  },
  beforeLoad: async ({ context, search }) => {
    const [me] = await Promise.all([ensureAuthenticatedSession(context.queryClient), loadPageTranslations()]);
    if (me.authenticated) {
      throw redirect({ to: (search.redirect || '/') as '/' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { t, tError, locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [lockSeconds, setLockSeconds] = useState<number>(() => readLockoutRemainingSeconds());

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const timer = window.setInterval(() => {
      const next = readLockoutRemainingSeconds();
      setLockSeconds(next);
      if (next <= 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockSeconds]);

  const cycleLocale = () => {
    const idx = SUPPORTED_LOCALES.indexOf(locale);
    const next: Locale = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length];
    setLocale(next);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || lockSeconds > 0) return;
    setSubmitting(true);
    setErrorMessage('');

    try {
      const res = await api.api.auth.login.$post({ json: { password } });
      await readApiJson<{ ok: true }>(res);
      clearLockout();
      setLockSeconds(0);
      await invalidateAuth(queryClient);
      await queryClient.fetchQuery(authMeQueryOptions());
      const target = search.redirect || '/';
      await navigate({ to: target as '/', replace: true });
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        if (cause.code === 'LOGIN_LOCKED') {
          writeLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
          setLockSeconds(Math.ceil(LOCKOUT_DURATION_MS / 1000));
          setErrorMessage('');
        } else if (cause.code === 'UNAUTHENTICATED') {
          setErrorMessage(t('auth.wrongPassword'));
        } else {
          setErrorMessage(tError(cause.code));
        }
      } else {
        setErrorMessage(tError('INTERNAL'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="login-page" className="relative flex min-h-screen w-full flex-col bg-bg text-text">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={loginBgUrl}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover object-center opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/70 via-bg/85 to-bg" />
      </div>

      <header className="relative z-10 flex items-center justify-end gap-2 px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={cycleLocale}
          aria-label={t('lang.label')}
          data-testid="locale-toggle"
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface/85 px-2.5 text-xs font-medium text-text transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{t(`lang.${locale}`)}</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={t('theme.toggle')}
          data-testid="theme-toggle"
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-border bg-surface/85 text-text transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-12">
        <section className="w-full max-w-md rounded-[var(--radius-xl)] border border-border bg-surface/95 p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src={aboutEmblemUrl}
              alt={t('app.name')}
              className="mb-4 h-16 w-16 rounded-[var(--radius-lg)] border border-border object-cover shadow-glow"
            />
            <h1 className="text-xl font-semibold tracking-tight text-text">{t('auth.loginTitle')}</h1>
            <p className="mt-1 text-sm text-text-muted">{t('auth.loginSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              <span>{t('auth.password')}</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="password"
                  autoComplete="current-password"
                  data-testid="login-password-input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  disabled={submitting || lockSeconds > 0}
                  className="flex h-11 w-full rounded-[var(--radius-md)] border border-border bg-bg pl-9 pr-3 text-sm text-text placeholder:text-text-muted transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </label>

            {lockSeconds > 0 ? (
              <div
                role="alert"
                data-testid="login-lockout-alert"
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-danger bg-surface-muted px-3.5 py-2.5 text-xs text-danger"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {t('auth.lockedCountdown')}{' '}
                  <strong data-testid="login-lockout-countdown" className="font-mono">
                    {formatCountdown(lockSeconds)}
                  </strong>
                </span>
              </div>
            ) : errorMessage ? (
              <div
                role="alert"
                data-testid="login-error"
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-danger bg-surface-muted px-3.5 py-2.5 text-xs text-danger"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            <button
              type="submit"
              data-testid="login-submit"
              disabled={submitting || lockSeconds > 0}
              className="inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-[var(--radius-md)] bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-[opacity,box-shadow] duration-150 hover:opacity-95 hover:shadow-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t('auth.loggingIn') : t('auth.loginButton')}
            </button>
          </form>

          <div className="mt-5 border-t border-border pt-4 text-center">
            <a href="/pwa-install" className="text-xs font-medium text-text-muted transition-colors hover:text-primary">
              {locale === 'en' ? 'Install PWA App' : '安装 PWA 应用'}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
