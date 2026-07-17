import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppVariables, Env } from '../types';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../types/domain-rules';
import { APP_VERSION } from '../version';
import { apiKeyConfigured, apiKeyStatus, authConfigured, checkPassword, createApiKey, createSession, deleteApiKey, destroySession, isAuthenticated, requireAuth, requireSessionAuth, safeFileName, tokenMatches, updateApiKeyNote } from '../lib/auth';
import {
  addRule,
  batchUpdateRules,
  createCategory,
  deleteCategory,
  deleteRule,
  getBackupData,
  getRulesOverview,
  getRulesData,
  importRulesData,
  insertRule,
  listRules,
  saveSettings,
  updateCategory,
  updateRule,
} from '../lib/db';
import { parseBulkImport } from '../lib/parser';
import { error, json, textFile } from '../lib/response';
import { linksByCategory } from '../lib/links';
import { resolveFile } from '../lib/formatters';
import { syncRuleSources } from '../lib/sync';
import { searchGeoSources } from '../lib/geosite';

export function createApp() {
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
type AppMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }>;

const apiCors: AppMiddleware = async (c, next) => {
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
  } });
  await next();
  c.header('access-control-allow-origin', '*');
  c.header('access-control-allow-headers', 'Authorization, Content-Type');
};
app.use('/api', apiCors);
app.use('/api/*', apiCors);

app.get('/health', async (c) => {
  const databaseReady = await c.env.DB.ping().catch(() => false);
  return c.json({ ok: databaseReady, database: databaseReady ? 'ok' : 'unavailable', runtime: c.env.RUNTIME ?? 'cloudflare', version: c.env.APP_VERSION ?? APP_VERSION }, databaseReady ? 200 : 503);
});

function externalRequestUrl(c: AppContext) {
  if (c.env.BASE_URL) return `${c.env.BASE_URL}${new URL(c.req.url).pathname}`;
  if (!c.env.TRUST_PROXY) return c.req.url;
  const original = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() || original.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() || original.host;
  return `${proto}://${host}${original.pathname}${original.search}`;
}

function withLinks(c: AppContext, data: Awaited<ReturnType<typeof getRulesData>>) {
  return { data, links: linksByCategory(data, externalRequestUrl(c), c.get('authType') === 'apiKey' ? undefined : c.env.RULE_TOKEN) };
}

async function adminApp(c: AppContext) {
  const url = new URL(c.req.url);
  // Assets canonicalises /index.html to /. Fetching / directly avoids a
  // redirect back into the application's authenticated root route.
  url.pathname = '/';
  url.search = '';
  const response = await c.env.ASSETS.fetch(new Request(url, c.req.raw));
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.delete('etag');
  headers.delete('last-modified');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

app.onError((err) => {
  console.error(err);
  return error(err.message || '服务器处理失败。', 500);
});

app.get('/api/auth/me', async (c) => {
  const authed = await isAuthenticated(c);
  return json({
    authenticated: authed,
    passwordConfigured: Boolean(c.env.ADMIN_PASSWORD),
    ruleTokenConfigured: Boolean(c.env.RULE_TOKEN),
    sessionSecretConfigured: Boolean(c.env.SESSION_SECRET),
    apiKeyConfigured: await apiKeyConfigured(c.env),
    d1Ready: Boolean(c.env.DB),
  });
});

app.post('/api/auth/login', async (c) => {
  if (!authConfigured(c.env)) return error('服务端尚未配置登录密钥。', 503);
  const body = (await c.req.json<{ password?: string }>().catch(() => ({}))) as { password?: string };
  if (!(await checkPassword(c.env, body.password ?? ''))) return error('密码不正确。', 401);
  await createSession(c);
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get('/api', requireAuth, async (c) => json({
  name: 'Private Rules API',
  version: 1,
  authentication: 'Authorization: Bearer <API_KEY>',
  endpoints: {
    rules: '/api/categories',
    backup: '/api/data',
    settings: '/api/settings',
    sync: '/api/sync',
  },
}));

app.get('/api/api-keys', requireSessionAuth, async (c) => json(await apiKeyStatus(c.env)));

app.post('/api/api-keys', requireSessionAuth, async (c) => {
  const body = await c.req.json<{ note?: string }>().catch(() => ({})) as { note?: string };
  return json(await createApiKey(c.env, body.note ?? ''), { status: 201 });
});

app.delete('/api/api-keys/:keyId', requireSessionAuth, async (c) => {
  await deleteApiKey(c.env, c.req.param('keyId'));
  return json({ deleted: true });
});

app.patch('/api/api-keys/:keyId', requireSessionAuth, async (c) => {
  const body = await c.req.json<{ note?: string }>().catch(() => ({})) as { note?: string };
  await updateApiKeyNote(c.env, c.req.param('keyId'), body.note ?? '');
  return json({ updated: true });
});

app.get('/api/categories', requireAuth, async (c) => json(withLinks(c, await getRulesOverview(c.env))));

app.get('/api/rules', requireAuth, async (c) => {
  const source = c.req.query('source');
  if (source && !['manual', 'upstream', 'url', 'geo'].includes(source)) return error('规则来源筛选无效。', 400);
  const requestedLimit = Number(c.req.query('limit') ?? String(UPSTREAM_RULE_PREVIEW_LIMIT));
  const limit = c.req.query('all') === '1' ? 0 : Number.isFinite(requestedLimit) ? requestedLimit : UPSTREAM_RULE_PREVIEW_LIMIT;
  return json({ rules: await listRules(c.env, {
    categoryId: c.req.query('categoryId') || undefined,
    query: c.req.query('q') || undefined,
    source: source as 'manual' | 'upstream' | 'url' | 'geo' | undefined,
    limit,
  }) });
});

app.get('/api/geo/search', requireAuth, async (c) => json({ results: await searchGeoSources(c.req.query('q') ?? '') }));

app.post('/api/categories', requireAuth, async (c) => {
  const input = await c.req.json<{ name?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; userAgent?: string; ruleOptimization?: 'none' | 'conservative' | 'aggressive' }>().catch(() => ({} as { name?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; userAgent?: string; ruleOptimization?: 'none' | 'conservative' | 'aggressive' }));
  let data = await createCategory(c.env, input);
  if (input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length) {
    const created = data.categories.find((category) => category.name === input.name) ?? [...data.categories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (created) await syncRuleSources(c.env, created.id);
    data = await getRulesOverview(c.env);
  }
  return json(withLinks(c, data), { status: 201 });
});

app.patch('/api/categories/:id', requireAuth, async (c) => {
  const data = await updateCategory(c.env, c.req.param('id'), await c.req.json().catch(() => ({})));
  return json(withLinks(c, data));
});

app.delete('/api/categories/:id', requireAuth, async (c) => {
  const data = await deleteCategory(c.env, c.req.param('id'));
  return json(withLinks(c, data));
});

app.post('/api/categories/:id/rules', requireAuth, async (c) => {
  const data = await addRule(c.env, c.req.param('id'), await c.req.json().catch(() => ({})));
  return json(withLinks(c, data), { status: 201 });
});

app.patch('/api/categories/:id/rules/:ruleId', requireAuth, async (c) => {
  const data = await updateRule(c.env, c.req.param('id'), c.req.param('ruleId'), await c.req.json().catch(() => ({})));
  return json(withLinks(c, data));
});

app.delete('/api/categories/:id/rules/:ruleId', requireAuth, async (c) => {
  const data = await deleteRule(c.env, c.req.param('id'), c.req.param('ruleId'));
  return json(withLinks(c, data));
});

app.post('/api/categories/:id/rules/batch', requireAuth, async (c) => {
  const body = await c.req.json<{ ruleIds?: string[]; action?: 'enable' | 'disable' | 'delete' }>().catch(() => ({})) as { ruleIds?: string[]; action?: 'enable' | 'disable' | 'delete' };
  if (!body.action || !['enable', 'disable', 'delete'].includes(body.action)) return error('批量操作无效。', 400);
  const data = await batchUpdateRules(c.env, c.req.param('id'), body.ruleIds ?? [], body.action);
  return json(withLinks(c, data));
});

app.post('/api/categories/:id/rules/bulk-import', requireAuth, async (c) => {
  const categoryId = c.req.param('id');
  const body = (await c.req.json<{ text?: string; confirm?: boolean }>().catch(() => ({}))) as {
    text?: string;
    confirm?: boolean;
  };
  const data = await getRulesData(c.env);
  const category = data.categories.find((item) => item.id === categoryId);
  if (!category) return error('分类不存在。', 404);
  const preview = parseBulkImport(body.text ?? '', category.rules);
  if (!body.confirm) return json({ preview });
  for (const [index, rule] of preview.rules.entries()) {
    await insertRule(c.env, categoryId, rule, Date.now() + index);
  }
  const next = await getRulesOverview(c.env);
  return json({ preview, ...withLinks(c, next) });
});

app.get('/api/settings', requireAuth, async (c) => {
  const data = await getRulesOverview(c.env);
  return json({ settings: data.settings, meta: data.meta });
});

app.patch('/api/settings', requireAuth, async (c) => {
  const input = await c.req.json().catch(() => ({}));
  await saveSettings(c.env, input);
  return json(withLinks(c, await getRulesOverview(c.env)));
});

app.get('/api/links', requireAuth, async (c) => {
  const data = await getRulesOverview(c.env);
  return json({ links: linksByCategory(data, externalRequestUrl(c), c.env.RULE_TOKEN) });
});

app.post('/api/sync', requireAuth, async (c) => {
  const results = await syncRuleSources(c.env);
  return json({ results, ...withLinks(c, await getRulesOverview(c.env)) });
});

app.post('/api/categories/:id/sync', requireAuth, async (c) => {
  const results = await syncRuleSources(c.env, c.req.param('id'));
  return json({ results, ...withLinks(c, await getRulesOverview(c.env)) });
});

app.get('/api/data', requireAuth, async (c) => json(await getBackupData(c.env)));

app.put('/api/data', requireAuth, async (c) => {
  const data = await c.req.json().catch(() => null);
  if (!data?.categories || !data?.settings) return error('备份 JSON 格式不正确。');
  return json(withLinks(c, await importRulesData(c.env, data)));
});

async function subscription(c: AppContext, file: string, access: 'public' | 'token') {
  if (!safeFileName(file)) return c.notFound();
  const data = await getRulesData(c.env);
  const result = resolveFile(data, file);
  if (!result) return c.notFound();
  if (access === 'public' && (result.category.tokenLinksEnabled !== false || result.category.publicLinksEnabled === false)) return c.notFound();
  if (access === 'token' && result.category.tokenLinksEnabled === false) return c.notFound();
  return textFile(result.body, result.contentType);
}

app.get('/rules/:file', async (c) => {
  return subscription(c, c.req.param('file'), 'public');
});

app.get('/sub/:token/:file', async (c) => {
  if (!tokenMatches(c.env, c.req.param('token'))) return c.notFound();
  return subscription(c, c.req.param('file'), 'token');
});

app.get('/', async (c) => {
  if (await isAuthenticated(c)) return c.redirect('/admin');
  return c.redirect('/admin/login');
});

app.get('/admin', async (c) => {
  if (!(await isAuthenticated(c))) return c.redirect('/admin/login');
  return adminApp(c);
});

app.get('/admin/login', (c) => adminApp(c));
app.all('/api/*', (c) => c.notFound());
app.all('/rules/*', (c) => c.notFound());
app.all('/sub/*', (c) => c.notFound());
app.get('*', async (c) => c.env.ASSETS.fetch(c.req.raw));
return app;
}
