/**
 * Core Simplified Chinese strings bundled in the first-screen entry chunk
 * (shell, navigation, auth, error codes, and overview dashboard).
 * Page-specific dictionaries live in `zh-CN.pages.ts` and are lazy-loaded by
 * route `beforeLoad` so the first-screen JS budget stays comfortably < 115 KB.
 */
export const zhCNCore = {
  'app.name': 'Private Rules',
  'app.previewBadge': '1.1.0 预览入口',

  // Navigation
  'nav.dashboard': '概览',
  'nav.groupRules': '分流规则',
  'nav.rules': '规则',
  'nav.subscriptions': '订阅',
  'nav.groupTemplates': '配置模板',
  'nav.catalog': '规则目录',
  'nav.cards': '场景库',
  'nav.templates': '模板',
  'nav.publications': '发布',
  'nav.settings': '设置',

  // Common (only what first-screen dashboard/shell needs)
  'common.disabled': '已停用',

  // Language (login & settings)
  'lang.label': '语言',
  'lang.zh-CN': '简体中文',
  'lang.zh-TW': '繁體中文',
  'lang.en': 'English',

  // Auth (topbar)
  'auth.logout': '退出登录',
  'auth.telegramBadge': 'Telegram Mini App',

  // Error codes needed before page dictionaries load
  'error.UNAUTHENTICATED': '登录已过期或凭据无效，请重新登录。',
  'error.FORBIDDEN': '当前会话没有执行此操作的权限。',
  'error.CSRF_REJECTED': '跨站请求被拒绝，请刷新页面后重试。',
  'error.RATE_LIMITED': '操作过于频繁，请稍后再试。',
  'error.LOGIN_LOCKED': '登录失败次数过多，请 15 分钟后再试。',
  'error.INTERNAL': '服务器处理失败，请查看服务端日志。',

  // Layout
  'layout.openMenu': '打开导航菜单',
  'layout.closeMenu': '关闭导航菜单',
  'layout.navigation': '主导航',
  'dashboard.authenticated': '已登录',
} as const;
