import { useEffect, useMemo, useState } from 'react';
import privateRulesAvatar from '../assets/private-rules-favicon.png';

type InstallChoice = { outcome: 'accepted' | 'dismissed' };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function detectDevice() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const safari = iOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return { iOS, android, safari };
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function PwaInstallPage() {
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
    const markInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) { setShowManual(true); return; }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === 'accepted') setInstalled(true);
    else setDismissed(true);
  }

  const platformName = device.iOS ? 'iPhone / iPad' : device.android ? 'Android' : '当前设备';
  const manualAndroid = showManual && !device.iOS;

  return (
    <main className="pwa-install-page">
      <div className="pwa-orb pwa-orb-one" aria-hidden="true" />
      <div className="pwa-orb pwa-orb-two" aria-hidden="true" />
      <section className="pwa-install-shell">
        <header className="pwa-install-header">
          <a className="pwa-wordmark" href="/admin"><img src={privateRulesAvatar} alt=""/><span>PRIVATE RULES</span></a>
          <span className="pwa-device-pill"><i />{platformName}</span>
        </header>

        <div className="pwa-install-hero">
          <div className="pwa-app-preview" aria-hidden="true">
            <div className="pwa-phone-frame">
              <span className="pwa-phone-island" />
              <div className="pwa-phone-screen">
                <div className="pwa-preview-top"><span /><span /></div>
                <img src={privateRulesAvatar} alt=""/>
                <strong>Private Rules</strong>
                <small>你的规则，随手可达</small>
                <div className="pwa-preview-card"><i/><span><b>规则同步完成</b><em>全部来源保持最新</em></span></div>
                <div className="pwa-preview-grid"><span/><span/><span/></div>
              </div>
            </div>
          </div>

          <div className="pwa-install-copy">
            <span className="pwa-eyebrow">INSTALL THE APP</span>
            <h1>{installed ? '已经安装完成' : '把规则中心装进口袋'}</h1>
            <p>{installed ? 'Private Rules 已在独立窗口运行，你可以像普通 App 一样继续使用。' : '无需应用商店。添加到主屏幕后，全屏打开、更快进入，也不会再被浏览器标签淹没。'}</p>

            {!installed && device.iOS && <div className="pwa-ios-guide">
              {!device.safari && <div className="pwa-browser-notice"><span>1</span><p><strong>请先用 Safari 打开</strong><small>iOS 上需要通过 Safari 添加到主屏幕</small></p></div>}
              <ol>
                <li><span>1</span><p><strong>点按 Safari 的分享按钮</strong><small>它通常位于屏幕底部，图标是方框加向上箭头</small></p><b className="pwa-share-symbol">↥</b></li>
                <li><span>2</span><p><strong>选择“添加到主屏幕”</strong><small>若未看到，请向下滚动分享菜单</small></p><b>＋</b></li>
                <li><span>3</span><p><strong>确认标题并点“添加”</strong><small>随后从主屏幕打开 Private Rules</small></p><b>完成</b></li>
              </ol>
            </div>}

            {!installed && !device.iOS && <>
              <button className="pwa-install-button" onClick={install}>
                <span>{prompt ? '立即安装' : '查看安装方法'}</span><b>→</b>
              </button>
              {dismissed && <small className="pwa-install-hint">安装已取消，你可以稍后再次刷新此页面重试。</small>}
              {manualAndroid && <div className="pwa-manual-guide"><strong>从浏览器菜单安装</strong><span>打开右上角菜单 ⋮，选择“安装应用”或“添加到主屏幕”。不同浏览器的文字可能略有差异。</span></div>}
            </>}

            {installed && <a className="pwa-install-button" href="/admin"><span>打开规则中心</span><b>→</b></a>}

            <div className="pwa-benefits">
              <span><b>01</b><strong>一触即达</strong><small>主屏幕直接启动</small></span>
              <span><b>02</b><strong>沉浸全屏</strong><small>告别浏览器工具栏</small></span>
              <span><b>03</b><strong>安全轻量</strong><small>沿用原有登录保护</small></span>
            </div>
          </div>
        </div>
        <footer className="pwa-install-footer"><span>PRIVATE RULES · PWA</span><a href="/admin">暂不安装，继续网页版</a></footer>
      </section>
    </main>
  );
}
