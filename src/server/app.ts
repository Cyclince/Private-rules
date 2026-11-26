import { Hono } from 'hono';
import { isAuthenticated } from '../lib/auth';
import { adminApp, previewApp, type AppBindings } from './helpers';
import { telegramAuditMiddleware } from './middleware/audit';
import { publicSubscriptionCors } from './middleware/cors';
import { csrfProtection } from './middleware/csrf';
import { handleError } from './middleware/errors';
import { apiKeyRoutes } from './routes/api-keys';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backup';
import { healthRoutes } from './routes/health';
import { legacyAliasRoutes } from './routes/legacy-aliases';
import { linksRoutes } from './routes/links';
import { rulesetRoutes } from './routes/rulesets';
import { settingsRoutes } from './routes/settings';
import { sourceRoutes } from './routes/sources';
import { subscriptionRoutes } from './routes/subscriptions';
import { syncRoutes } from './routes/sync';
import { telegramRoutes } from './routes/telegram';

export function createApp() {
  const app = new Hono<AppBindings>();

  app.onError(handleError);

  // Security & audit middlewares: no `ACAO: *` on `/api/*`; CSRF enforced on Cookie writes.
  app.use('/api/*', csrfProtection);
  app.use('/api/*', telegramAuditMiddleware);

  // Public subscription routes allow cross-origin fetches (`ACAO: *`).
  app.use('/rules/*', publicSubscriptionCors);
  app.use('/sub/*', publicSubscriptionCors);
  app.use('/p/*', publicSubscriptionCors);
  app.use('/t/*', publicSubscriptionCors);

  const routes = app
    .route('/', healthRoutes)
    .route('/', authRoutes)
    .route('/', apiKeyRoutes)
    .route('/', rulesetRoutes)
    .route('/', sourceRoutes)
    .route('/', syncRoutes)
    .route('/', linksRoutes)
    .route('/', settingsRoutes)
    .route('/', backupRoutes)
    .route('/', telegramRoutes)
    .route('/', legacyAliasRoutes)
    .route('/', subscriptionRoutes)
    .get('/', async (c) => {
      if (await isAuthenticated(c)) return c.redirect('/admin');
      return c.redirect('/admin/login');
    })
    .get('/admin', (c) => adminApp(c))
    .get('/admin/login', (c) => adminApp(c))
    .get('/preview', (c) => previewApp(c))
    .get('/preview/*', (c) => previewApp(c))
    .get('/pwa-install', (c) => adminApp(c))
    .get('/pwa-install/', (c) => adminApp(c))
    .all('/api/*', (c) => c.notFound())
    .all('/rules/*', (c) => c.notFound())
    .all('/sub/*', (c) => c.notFound())
    .get('*', async (c) => c.env.ASSETS.fetch(c.req.raw));

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
