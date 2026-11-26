import { Hono } from 'hono';
import { requireSessionAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { APP_VERSION } from '../../version';
import type { AppBindings } from '../helpers';

export const healthRoutes = new Hono<AppBindings>()
  .get('/health', async (c) => {
    const databaseReady = await c.env.DB.ping().catch(() => false);
    return c.json(
      {
        ok: databaseReady,
        database: databaseReady ? 'ok' : 'unavailable',
        runtime: c.env.RUNTIME ?? 'cloudflare',
        version: c.env.APP_VERSION ?? APP_VERSION,
      },
      databaseReady ? 200 : 503,
    );
  })
  .get('/api/service-status', requireSessionAuth, async (c) => {
    const checkedAt = new Date().toISOString();
    const databaseReady = await c.env.DB.ping().catch(() => false);
    let telegram: {
      status: 'online' | 'offline' | 'unconfigured';
      checkedAt: string;
      username?: string;
      error?: string;
    } = { status: 'unconfigured', checkedAt };
    if (c.env.TELEGRAM?.enabled && c.env.TELEGRAM_CLIENT) {
      try {
        const bot = await c.env.TELEGRAM_CLIENT.getMe();
        telegram = { status: 'online', checkedAt, username: bot.username };
      } catch (cause) {
        telegram = {
          status: 'offline',
          checkedAt,
          error: (cause instanceof Error ? cause.message : '检测失败').slice(0, 160),
        };
      }
    }
    return json({
      checkedAt,
      services: {
        database: { status: databaseReady ? 'online' : 'offline', checkedAt },
        password: { status: c.env.ADMIN_PASSWORD ? 'configured' : 'unconfigured', checkedAt },
        ruleToken: { status: c.env.RULE_TOKEN ? 'configured' : 'unconfigured', checkedAt },
        telegram,
      },
    });
  });
