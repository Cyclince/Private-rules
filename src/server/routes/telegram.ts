import { Hono } from 'hono';
import { TelegramRepository } from '../../application/telegram/repository';
import { createRepositories } from '../../data/repositories';
import {
  createTelegramSession,
  currentTelegramSession,
  logoutTelegramSession,
} from '../../integrations/telegram/session';
import { telegramWebhook } from '../../integrations/telegram/webhook';
import { clientIdentity, requireSessionAuth } from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import type { AppBindings } from '../helpers';
import { validate } from '../middleware/validate';
import {
  telegramAuditLogsQuerySchema,
  telegramChatIdParamSchema,
  telegramNotificationsBodySchema,
  telegramSessionBodySchema,
} from './schemas';

export const telegramRoutes = new Hono<AppBindings>()
  .post('/api/telegram/webhook', telegramWebhook)
  .post('/api/telegram/session', validate('json', telegramSessionBodySchema), async (c) => {
    const rateIdentity = clientIdentity(c);
    const rate = await createRepositories(c.env.DB).rateLimits.consume(rateIdentity, 'telegram-session', 10);
    if (!rate.allowed) {
      throw new AppError('RATE_LIMITED', '登录请求过于频繁。');
    }
    const body = c.req.valid('json');
    return c.json(await createTelegramSession(c, body.initData), 201);
  })
  .get('/api/telegram/session/me', async (c) => {
    const session = await currentTelegramSession(c);
    if (!session) {
      throw new AppError('UNAUTHENTICATED', 'Telegram 会话无效或已过期。');
    }
    return json({ telegramUserId: session.telegramUserId, expiresAt: session.expiresAt });
  })
  .post('/api/telegram/session/logout', async (c) => {
    await logoutTelegramSession(c);
    return c.json({ loggedOut: true });
  })
  .get('/api/telegram/audit-logs', requireSessionAuth, validate('query', telegramAuditLogsQuerySchema), async (c) => {
    const { limit } = c.req.valid('query');
    const parsedLimit = Number(limit ?? 100);
    return json({
      logs: await new TelegramRepository(c.env.DB).listAuditLogs(Number.isFinite(parsedLimit) ? parsedLimit : 100),
    });
  })
  .get('/api/telegram/notifications', requireSessionAuth, async (c) => {
    const chatId = c.env.TELEGRAM?.notificationChatId || c.env.TELEGRAM?.userId;
    if (!c.env.TELEGRAM?.enabled || !chatId) {
      return json({ enabled: false, preferences: { mode: 'off', muted: false, digestTime: '09:00' } });
    }
    return json({
      enabled: true,
      preferences: await new TelegramRepository(c.env.DB).getNotificationPreferences(chatId),
    });
  })
  .put(
    '/api/telegram/notifications',
    requireSessionAuth,
    validate('json', telegramNotificationsBodySchema),
    async (c) => {
      const chatId = c.env.TELEGRAM?.notificationChatId || c.env.TELEGRAM?.userId;
      if (!c.env.TELEGRAM?.enabled || !chatId) {
        throw new AppError('NOT_FOUND', 'Telegram Bot 尚未配置。');
      }
      const body = c.req.valid('json');
      const preferences = await new TelegramRepository(c.env.DB).saveNotificationPreferences(chatId, body);
      return json({ preferences });
    },
  )
  .put(
    '/api/telegram/notifications/:chatId',
    requireSessionAuth,
    validate('param', telegramChatIdParamSchema),
    validate('json', telegramNotificationsBodySchema),
    async (c) => {
      const { chatId } = c.req.valid('param');
      const body = c.req.valid('json');
      await new TelegramRepository(c.env.DB).saveNotificationPreferences(chatId, body);
      return json({ updated: true });
    },
  );
