import type { ClientLink } from '../../types/domain-rules';
import { useState } from 'react';
import { copyText } from '../lib/clipboard';
import { preferHttpsLink } from '../lib/links';

export function LinkSheet({
  links,
  onClose,
  onToast,
}: {
  links: ClientLink[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);

  async function copy(url: string) {
    if (!url) {
      onToast('当前没有可用订阅链接，请检查访问策略和 RULE_TOKEN');
      return;
    }
    try {
      await copyText(preferHttpsLink(url));
      onToast('链接已复制');
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : '复制失败，请手动复制');
    }
  }

  async function showPreview(link: ClientLink) {
    const response = await fetch(preferHttpsLink(link.publicUrl));
    setPreview({
      title: `${link.name} 预览`,
      content: await response.text(),
    });
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="link-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>选择你的代理软件</h2>
        <p>复制适合该客户端的订阅链接，私密访问会自动携带密钥</p>
        <div className="client-grid">
          {links.map((link) => (
            <div className="client-row" key={link.id}>
              <span className="client-icon">{link.icon}</span>
              <div>
                <strong>{link.name}</strong>
                <span>{link.description}</span>
                {!link.supported && <span>即将支持，当前复制通用链接</span>}
              </div>
              <div className="client-actions">
                <button className="primary-action" disabled={!link.recommendedUrl} onClick={() => copy(link.recommendedUrl)}>复制</button>
                <button onClick={() => showPreview(link)}>预览</button>
              </div>
            </div>
          ))}
        </div>
        {preview && (
          <div className="preview-box">
            <div className="section-inline">
              <strong>{preview.title}</strong>
              <button onClick={() => setPreview(null)}>关闭</button>
            </div>
            <pre>{preview.content.slice(0, 2000)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
