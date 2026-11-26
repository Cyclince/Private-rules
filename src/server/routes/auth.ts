import { Hono } from 'hono';
import { createRepositories } from '../../data/repositories';
import { currentTelegramSession } from '../../integrations/telegram/session';
import {
  apiKeyConfigured,
  authConfigured,
  checkPassword,
  clientIdentity,
  createSession,
  destroySession,
  isAuthenticated,
} from '../../lib/auth';
import { json } from '../../lib/response';
import { AppError } from '../../shared/errors';
import { APP_VERSION } from '../../version';
import type { AppBindings } from '../helpers';
import { validate } from '../middleware/validate';
import { loginBodySchema } from './schemas';

const LOGIN_OPERATION = 'login-failure';
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

export const authRoutes = new Hono<AppBindings>()
  .get('/api/auth/me', async (c) => {
    const authed = await isAuthenticated(c);
    const telegramSession = await currentTelegramSession(c);
    return json({
      authenticated: authed,
      authType: telegramSession ? 'telegram' : authed ? 'session' : undefined,
      passwordConfigured: Boolean(c.env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(c.env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(c.env.SESSION_SECRET),
      apiKeyConfigured: await apiKeyConfigured(c.env),
      d1Ready: Boolean(c.env.DB),
      appVersion: c.env.APP_VERSION ?? APP_VERSION,
    });
  })
  .post('/api/auth/login', validate('json', loginBodySchema), async (c) => {
    if (!authConfigured(c.env)) {
      throw new AppError('NOT_CONFIGURED', '服务端尚未配置登录密钥。');
    }
    const body = c.req.valid('json');
    const { rateLimits } = createRepositories(c.env.DB);
    const identity = clientIdentity(c);
    if (!(await rateLimits.peek(identity, LOGIN_OPERATION, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS)).allowed) {
      throw new AppError('LOGIN_LOCKED', '登录失败次数过多，请 15 分钟后再试。');
    }
    if (!(await checkPassword(c.env, body.password))) {
      await rateLimits.consume(identity, LOGIN_OPERATION, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS);
      throw new AppError('UNAUTHENTICATED', '密码不正确。');
    }
    await rateLimits.reset(identity, LOGIN_OPERATION);
    await createSession(c);
    return c.json({ ok: true });
  })
  .post('/api/auth/logout', async (c) => {
    await destroySession(c);
    return c.json({ ok: true });
  });
