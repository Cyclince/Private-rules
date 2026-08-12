import type { TelegramConfig } from '../../integrations/telegram/config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  adminPassword: string;
  sessionSecret: string;
  ruleToken: string;
  baseUrl: string;
  databasePath: string;
  host: string;
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  scheduler: { enabled: boolean; intervalSeconds: number };
  trustProxy: boolean;
  logLevel: LogLevel;
  telegram: TelegramConfig;
}

export function normalizeBaseUrl(value: string | undefined) {
  const input = value?.trim() ?? '';
  if (!input) return '';
  const parsed = new URL(input);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('BASE_URL 必须使用 http 或 https。');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  if (parsed.pathname === '/') parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}
