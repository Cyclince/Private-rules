import { useState } from 'react';
import privateRulesAvatar from '../assets/private-rules-avatar.png';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [wallpaper, setWallpaper] = useState('https://uapis.cn/api/v1/random/image?category=acg&type=pc');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      setLoading(false);
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? '登录失败');
      return;
    }
    setLeaving(true);
    window.setTimeout(() => window.location.assign('/admin?enter=login'), 620);
  }

  return (
    <main className={`login-page login-immersive ${leaving ? 'login-leaving' : ''}`}>
      <img className="login-wallpaper" src={wallpaper} alt="" aria-hidden="true" onError={() => { if (!wallpaper.includes('paugram')) setWallpaper('https://api.paugram.com/bing/'); }} />
      <div className="login-wallpaper-shade" />
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><img src={privateRulesAvatar} alt="Private Rules 规则守护者"/><div><strong>Private Rules</strong><span>规则控制台</span></div></div>
        <h1>登录后台</h1>
        <p>输入后台密码后继续管理私有规则</p>
        <input
          autoComplete="current-password"
          autoFocus
          className="app-input"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="使用后台密码登录"
          type="password"
          value={password}
        />
        {error && <span className="form-error">{error}</span>}
        <button className="primary-action" disabled={!password.trim() || loading} type="submit">
          {loading ? '登录中...' : '进入后台'}
        </button>
      </form>
    </main>
  );
}
