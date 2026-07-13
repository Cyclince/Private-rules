import { UiIcon } from './ui-icon';

export function AboutPanel() {
  return <div className="page-stack unified-page">
    <header className="page-title"><div><span className="eyebrow">ABOUT</span><h1>关于 Private Rules</h1><p>运行在 Cloudflare Workers 上的私有规则管理工具</p></div></header>
    <div className="about-grid">
      <section className="soft-card unified-card"><span className="metric-icon blue"><UiIcon name="rules"/></span><h2>集中维护</h2><p>按分类维护域名、关键词与 IP 规则，并按需组合上游来源</p></section>
      <section className="soft-card unified-card"><span className="metric-icon purple"><UiIcon name="links"/></span><h2>多端订阅</h2><p>统一生成 YAML、LIST、JSON 与纯地址文件，覆盖常用代理客户端</p></section>
      <section className="soft-card unified-card"><span className="metric-icon green"><UiIcon name="database"/></span><h2>私有数据</h2><p>规则保存在自己的 D1 数据库中，并支持 JSON 完整备份</p></section>
    </div>
    <section className="soft-card unified-card project-info-card">
      <div><span className="metric-icon cyan"><UiIcon name="info"/></span><span><h2>项目信息</h2><p>开源代码、更新记录与作者频道</p></span></div>
      <div className="project-links"><a href="https://github.com/Cyclince/Private_rules" target="_blank" rel="noreferrer"><UiIcon name="rules" size={18}/><span><strong>GitHub 开源仓库</strong><small>Cyclince/Private_rules</small></span><UiIcon name="chevronRight" size={17}/></a><a href="https://t.me/chong_redaily" target="_blank" rel="noreferrer"><UiIcon name="links" size={18}/><span><strong>作者 Telegram 频道</strong><small>@chong_redaily</small></span><UiIcon name="chevronRight" size={17}/></a></div>
    </section>
    <section className="disclaimer-card"><strong>免责声明</strong><p>本项目仅供学习与技术测试使用，请遵守当地法律法规。使用者对配置、转发内容与访问行为承担全部责任，开发者不对任何直接或间接损失负责。</p></section>
  </div>;
}
