import { ArrowRight, CheckCircle2, Download, ShieldCheck, Smartphone, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import emblemUrl from '../assets/miku-about-emblem.webp';
import { useI18n } from '../i18n';

type InstallChoice = { outcome: 'accepted' | 'dismissed' };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function detectDevice() {
  if (typeof navigator === 'undefined') return { iOS: false, android: false, safari: false };
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const safari = iOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return { iOS, android, safari };
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function PwaInstallPage() {
  const { locale } = useI18n();
  const isEn = locale === 'en';
  const device = useMemo(detectDevice, []);
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!prompt) {
      setShowManual(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === 'accepted') setInstalled(true);
    else setDismissed(true);
  }

  const platformName = device.iOS ? 'iPhone / iPad' : device.android ? 'Android' : isEn ? 'Current Device' : '当前设备';

  return (
    <main
      data-testid="pwa-install-page"
      className="flex min-h-screen w-full flex-col items-center justify-center bg-bg px-4 py-10 text-text"
    >
      <section className="flex w-full max-w-2xl flex-col gap-6 rounded-[var(--radius-xl)] border border-border bg-surface p-6 shadow-lg sm:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <a href="/admin" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-text">
            <img
              src={emblemUrl}
              alt="Private Rules"
              className="h-9 w-9 rounded-[var(--radius-sm)] border border-border object-cover"
            />
            <span>Private Rules</span>
          </a>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-medium text-text-muted">
            <Smartphone className="h-3.5 w-3.5 text-primary" />
            {platformName}
          </span>
        </header>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">PWA INSTALL</span>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {installed
              ? isEn
                ? 'Installed and ready'
                : '已经安装完成'
              : isEn
                ? 'Put Private Rules in your pocket'
                : '把规则中心装进口袋'}
          </h1>
          <p className="text-sm text-text-muted">
            {installed
              ? isEn
                ? 'Private Rules is running in standalone app mode.'
                : 'Private Rules 已在独立窗口运行，你可以像原生应用一样快速管理分流规则。'
              : isEn
                ? 'No app store needed. Add to your home screen for full-screen launch and instant access.'
                : '无需应用商店。添加到主屏幕后，全屏打开、更快进入，也不会再被浏览器标签淹没。'}
          </p>
        </div>

        {!installed && device.iOS ? (
          <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted p-4 text-xs">
            {!device.safari ? (
              <div className="rounded bg-surface px-3 py-2 font-medium text-warning">
                {isEn
                  ? 'Open this page in Safari on iOS to add to Home Screen.'
                  : '请先在 Safari 中打开本页以添加到主屏幕。'}
              </div>
            ) : null}
            <ol className="flex flex-col gap-2">
              <li className="flex items-center justify-between rounded bg-surface px-3 py-2">
                <span>1. {isEn ? 'Tap the Safari Share button' : '点按 Safari 底部或顶部的“分享”按钮'}</span>
                <span className="font-mono text-primary">↥</span>
              </li>
              <li className="flex items-center justify-between rounded bg-surface px-3 py-2">
                <span>2. {isEn ? 'Choose "Add to Home Screen"' : '选择“添加到主屏幕”'}</span>
                <span className="font-mono text-primary">＋</span>
              </li>
              <li className="flex items-center justify-between rounded bg-surface px-3 py-2">
                <span>3. {isEn ? 'Confirm title and tap Add' : '确认名称后点按“添加”'}</span>
                <CheckCircle2 className="h-4 w-4 text-success" />
              </li>
            </ol>
          </div>
        ) : null}

        {!installed && !device.iOS ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              data-testid="pwa-install-action"
              onClick={() => void handleInstall()}
              className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-md)] bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-shadow hover:shadow-glow sm:w-fit"
            >
              <Download className="h-4 w-4" />
              <span>{prompt ? (isEn ? 'Install Now' : '立即安装') : isEn ? 'View Install Steps' : '查看安装方法'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>

            {dismissed ? (
              <p className="text-xs text-text-muted">
                {isEn
                  ? 'Installation dismissed. Refresh this page to retry anytime.'
                  : '安装已取消，你可以稍后刷新页面重试。'}
              </p>
            ) : null}

            {showManual ? (
              <div
                data-testid="pwa-manual-guide"
                className="rounded-[var(--radius-md)] border border-border bg-surface-muted p-4 text-xs text-text-muted"
              >
                <div className="font-semibold text-text">{isEn ? 'Install from Browser Menu' : '从浏览器菜单安装'}</div>
                <p className="mt-1">
                  {isEn
                    ? 'Open the browser menu (⋮ or address bar install icon) and choose "Install app" or "Add to Home screen".'
                    : '打开浏览器右上角菜单 ⋮ 或地址栏右侧的安装图标，选择“安装应用”或“添加到主屏幕”。'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {installed ? (
          <a
            href="/admin"
            className="inline-flex h-11 w-fit items-center gap-2 rounded-[var(--radius-md)] bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:shadow-glow"
          >
            <span>{isEn ? 'Open Console' : '打开规则中心'}</span>
            <ArrowRight className="h-4 w-4" />
          </a>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3 text-xs">
            <Zap className="h-4 w-4 text-primary" />
            <div className="mt-1.5 font-semibold">{isEn ? 'Instant Launch' : '一触即达'}</div>
            <p className="mt-0.5 text-text-muted">{isEn ? 'Launch straight from home screen' : '主屏幕直接启动'}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3 text-xs">
            <Smartphone className="h-4 w-4 text-primary" />
            <div className="mt-1.5 font-semibold">{isEn ? 'Standalone UI' : '沉浸全屏'}</div>
            <p className="mt-0.5 text-text-muted">{isEn ? 'No browser chrome clutter' : '告别浏览器工具栏'}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3 text-xs">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <div className="mt-1.5 font-semibold">{isEn ? 'Zero API Cache' : '安全轻量'}</div>
            <p className="mt-0.5 text-text-muted">
              {isEn ? 'Subscriptions & APIs never cached offline' : '沿用登录保护，API 与订阅不缓存'}
            </p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-xs text-text-muted">
          <span>PRIVATE RULES · PWA</span>
          <a href="/admin" className="font-medium text-primary hover:underline">
            {isEn ? 'Continue in browser' : '暂不安装，继续网页版'}
          </a>
        </footer>
      </section>
    </main>
  );
}
