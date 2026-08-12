export const TELEGRAM_COMMANDS = [
  { command: 'start', description: '首页、状态和快捷按钮' },
  { command: 'help', description: '帮助、权限和安全说明' },
  { command: 'status', description: '服务、数据库和同步状态' },
  { command: 'rules', description: '浏览或搜索规则' },
  { command: 'sources', description: '查看上游与同步状态' },
  { command: 'sync', description: '查看状态或执行手动同步' },
] as const;
