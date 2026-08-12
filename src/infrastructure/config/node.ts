import { normalizeBaseUrl, type AppConfig, type LogLevel } from './types';
import { parseTelegramConfig } from '../../integrations/telegram/config';
type RawEnvironment = Record<string, string | undefined>;

function booleanValue(env: RawEnvironment, name: string, fallback: boolean) {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} 必须是 true 或 false。`);
}

function integerValue(env: RawEnvironment, name: string, fallback: number, min: number, max: number) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} 必须是整数。`);
  const value = Number(raw);
  if (value < min || value > max) throw new Error(`${name} 必须介于 ${min} 和 ${max} 之间。`);
  return value;
}

export function parseNodeConfig(env: RawEnvironment): AppConfig {
  const nodeEnv = (env.NODE_ENV?.trim() || 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV 必须是 development、test 或 production。');
  const adminPassword = env.ADMIN_PASSWORD?.trim() ?? '';
  const sessionSecret = env.SESSION_SECRET?.trim() ?? '';
  if (!adminPassword) throw new Error('ADMIN_PASSWORD 必须配置。');
  if (sessionSecret && nodeEnv === 'production' && sessionSecret.length < 32) throw new Error('生产环境自定义 SESSION_SECRET 至少需要 32 个字符。');
  const logLevel = (env.LOG_LEVEL?.trim().toLowerCase() || 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) throw new Error('LOG_LEVEL 无效。');
  return {
    adminPassword, sessionSecret, ruleToken: env.RULE_TOKEN?.trim() ?? '',
    baseUrl: normalizeBaseUrl(env.BASE_URL), databasePath: env.DATABASE_PATH?.trim() || '/app/data/private-rules.db',
    host: env.HOST?.trim() || '0.0.0.0', port: integerValue(env, 'PORT', 5173, 1, 65_535), nodeEnv,
    scheduler: { enabled: booleanValue(env, 'SCHEDULER_ENABLED', true), intervalSeconds: integerValue(env, 'SCHEDULER_INTERVAL_SECONDS', 60, 1, 86_400) },
    trustProxy: booleanValue(env, 'TRUST_PROXY', false), logLevel,
    telegram: parseTelegramConfig(env, nodeEnv === 'production'),
  };
}
