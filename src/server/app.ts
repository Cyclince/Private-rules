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
  findRuleConflicts,
  getRulesOverview,
  getRulesData,
  importRulesData,
  insertRule,
  listRules,
  optimizeManualRules,
  previewManualRuleOptimization,
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
import { createSource, deleteSource, getSource, listSources, previewSource, syncSourceById, toggleSource, updateSource, type SourceInput } from '../application/sources/use-cases';
import { createTelegramSession, currentTelegramSession, logoutTelegramSession } from '../integrations/telegram/session';
import { telegramWebhook } from '../integrations/telegram/webhook';
import { TelegramRepository } from '../application/telegram/repository';
import { getCachedIconPack, refreshIconPacks } from '../lib/icon-packs';

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
function persistentRateLimit(operation: string, limit: number): AppMiddleware {
  return async (c, next) => {
    const identity = c.get('telegramUserId') || c.get('sessionId')
      || c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const result = await new TelegramRepository(c.env.DB).consumeRateLimit(identity, operation, limit);
    if (!result.allowed) {
      c.res = error('操作过于频繁，请稍后再试。', 429);
      return;
    }
    await next();
  };
}
app.use('/api', apiCors);
app.use('/api/*', apiCors);
app.use('/api/*', async (c, next) => {
  await next();
  if (c.req.method === 'GET' || c.get('authType') !== 'telegram' || c.req.path.startsWith('/api/telegram/session')) return;
  const telegramUserId = c.get('telegramUserId');
  if (!telegramUserId) return;
  await new TelegramRepository(c.env.DB).audit({
    telegramUserId,
    action: `${c.req.method} ${c.req.path}`.slice(0, 180),
    targetType: 'api',
    result: c.res.status < 400 ? 'success' : c.res.status === 403 ? 'denied' : 'failure',
    summary: `status=${c.res.status}`,
  }).catch(() => undefined);
});

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
  const correlationId = crypto.randomUUID().slice(0, 12);
  console.error(`[request:${correlationId}]`, err instanceof Error ? err.message : 'unknown error');
  const known = err instanceof Error && /不存在|无效|格式|请输入|请选择|只读|不能|必须|重复|正在同步|任务正在执行|SSRF|上游|GeoSite|GeoIP|来源/.test(err.message);
  return error(known && err instanceof Error ? err.message : `服务器处理失败。错误编号：${correlationId}`, known ? 400 : 500);
});

app.get('/api/auth/me', async (c) => {
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
});

app.post('/api/telegram/webhook', telegramWebhook);

app.post('/api/telegram/session', async (c) => {
  const rateIdentity = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const repository = new TelegramRepository(c.env.DB);
  const rate = await repository.consumeRateLimit(rateIdentity, 'telegram-session', 10);
  if (!rate.allowed) return error('登录请求过于频繁。', 429);
  const body = await c.req.json<{ initData?: string }>().catch(() => ({})) as { initData?: string };
  try { return c.json(await createTelegramSession(c, body.initData ?? ''), 201); }
  catch (cause) { return error(cause instanceof Error ? cause.message : 'Telegram 登录失败。', 401); }
});

app.get('/api/telegram/session/me', async (c) => {
  const session = await currentTelegramSession(c);
  if (!session) return error('Telegram 会话无效或已过期。', 401);
  return json({ telegramUserId: session.telegramUserId, expiresAt: session.expiresAt });
});

app.post('/api/telegram/session/logout', async (c) => {
  await logoutTelegramSession(c);
  return c.json({ loggedOut: true });
});

app.get('/api/telegram/audit-logs', requireSessionAuth, async (c) => {
  return json({ logs: await new TelegramRepository(c.env.DB).listAuditLogs(Number(c.req.query('limit') ?? 100)) });
});

app.get('/api/telegram/notifications', requireSessionAuth, async (c) => {
  const chatId = c.env.TELEGRAM?.notificationChatId || c.env.TELEGRAM?.userId;
  if (!c.env.TELEGRAM?.enabled || !chatId) return json({ enabled: false, preferences: { mode: 'off', muted: false, digestTime: '09:00' } });
  return json({ enabled: true, preferences: await new TelegramRepository(c.env.DB).getNotificationPreferences(chatId) });
});

app.put('/api/telegram/notifications', requireSessionAuth, async (c) => {
  const chatId = c.env.TELEGRAM?.notificationChatId || c.env.TELEGRAM?.userId;
  if (!c.env.TELEGRAM?.enabled || !chatId) return error('Telegram Bot 尚未配置。', 404);
  const body = await c.req.json<{ mode?: 'immediate' | 'digest' | 'off'; muted?: boolean; digestTime?: string }>().catch(() => ({})) as { mode?: 'immediate' | 'digest' | 'off'; muted?: boolean; digestTime?: string };
  if (body.mode && !['immediate', 'digest', 'off'].includes(body.mode)) return error('通知模式无效。');
  if (body.muted !== undefined && typeof body.muted !== 'boolean') return error('静音状态无效。');
  if (body.digestTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.digestTime)) return error('摘要时间无效。');
  const preferences = await new TelegramRepository(c.env.DB).saveNotificationPreferences(chatId, body);
  return json({ preferences });
});

app.put('/api/telegram/notifications/:chatId', requireSessionAuth, async (c) => {
  const chatId = c.req.param('chatId');
  if (!/^-?\d+$/.test(chatId)) return error('Chat ID 无效。');
  const body = await c.req.json<{ syncFailed?: boolean; syncCompleted?: boolean; securityAlerts?: boolean; enabled?: boolean; mode?: 'immediate' | 'digest' | 'off'; muted?: boolean; digestTime?: string }>().catch(() => ({}));
  await new TelegramRepository(c.env.DB).saveNotificationPreferences(chatId, body);
  return json({ updated: true });
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

app.get('/api/rules', requireAuth, persistentRateLimit('rule-search', 60), async (c) => {
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

app.get('/api/categories/:categoryId/sources', requireAuth, async (c) => {
  return json({ sources: await listSources(c.env, c.req.param('categoryId')) });
});

app.get('/api/categories/:categoryId/sources/:sourceId', requireAuth, async (c) => {
  const source = await getSource(c.env, c.req.param('sourceId'), c.req.param('categoryId'));
  return source ? json({ source }) : error('来源不存在。', 404);
});

app.post('/api/categories/:categoryId/sources/preview', requireAuth, persistentRateLimit('source-preview', 10), async (c) => {
  const input = await c.req.json<SourceInput>().catch(() => null);
  if (!input) return error('来源参数无效。');
  return json({ preview: await previewSource(c.env, input) });
});

app.post('/api/categories/:categoryId/sources', requireAuth, persistentRateLimit('source-create', 10), async (c) => {
  const input = await c.req.json<SourceInput>().catch(() => null);
  if (!input) return error('来源参数无效。');
  return json({ source: await createSource(c.env, c.req.param('categoryId'), input) }, { status: 201 });
});

app.patch('/api/categories/:categoryId/sources/:sourceId', requireAuth, async (c) => {
  const existing = await getSource(c.env, c.req.param('sourceId'), c.req.param('categoryId'));
  if (!existing) return error('来源不存在。', 404);
  const input = await c.req.json<SourceInput>().catch(() => null);
  if (!input) return error('来源参数无效。');
  return json({ source: await updateSource(c.env, existing.id, input) });
});

app.delete('/api/categories/:categoryId/sources/:sourceId', requireAuth, async (c) => {
  const existing = await getSource(c.env, c.req.param('sourceId'), c.req.param('categoryId'));
  if (!existing) return error('来源不存在。', 404);
  return json({ deleted: await deleteSource(c.env, existing.id) });
});

app.post('/api/categories/:categoryId/sources/:sourceId/toggle', requireAuth, async (c) => {
  const existing = await getSource(c.env, c.req.param('sourceId'), c.req.param('categoryId'));
  if (!existing) return error('来源不存在。', 404);
  const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') return error('enabled 必须是布尔值。');
  return json({ source: await toggleSource(c.env, existing.id, body.enabled) });
});

app.post('/api/categories/:categoryId/sources/:sourceId/interval', requireAuth, async (c) => {
  const existing = await getSource(c.env, c.req.param('sourceId'), c.req.param('categoryId'));
  if (!existing) return error('来源不存在。', 404);
  const body = await c.req.json<{ syncIntervalMinutes?: number }>().catch(() => ({})) as { syncIntervalMinutes?: number };
  return json({ source: await updateSource(c.env, existing.id, {
    sourceType: existing.sourceType ?? 'url',
    name: existing.name,
    url: existing.url,
    geositeName: existing.geositeName,
    geoipName: existing.geoipName,
    userAgent: existing.userAgent,
    ruleOptimization: existing.ruleOptimization,
    enabled: existing.enabled,
    syncIntervalMinutes: body.syncIntervalMinutes,
  }) });
});

app.post('/api/categories/:categoryId/sources/:sourceId/sync', requireAuth, persistentRateLimit('source-sync', 10), async (c) => {
  const existing = await getSource(c.env, c.req.param('sourceId'), c.req.param('categoryId'));
  if (!existing) return error('来源不存在。', 404);
  return json({ result: await syncSourceById(c.env, existing.id) });
});

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
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  if (c.get('authType') === 'telegram' && Object.keys(input).some((key) => !['enabled', 'tokenLinksEnabled', 'publicLinksEnabled'].includes(key))) {
    return error('Telegram 会话只能修改分类启用状态和订阅策略。', 403);
  }
  const data = await updateCategory(c.env, c.req.param('id'), input);
  return json(withLinks(c, data));
});

app.delete('/api/categories/:id', requireAuth, async (c) => {
  const data = await deleteCategory(c.env, c.req.param('id'));
  return json(withLinks(c, data));
});

app.post('/api/categories/:id/rules', requireAuth, async (c) => {
  const result = await addRule(c.env, c.req.param('id'), await c.req.json().catch(() => ({})));
  if ('conflicts' in result) return c.json({ error: '新规则与现有规则重复或冲突。', conflicts: result.conflicts }, 409);
  return json({ replaced: result.replaced, ...withLinks(c, result) }, { status: 201 });
});

app.patch('/api/categories/:id/rules/:ruleId', requireAuth, async (c) => {
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const data = await updateRule(c.env, c.req.param('id'), c.req.param('ruleId'), input);
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
  const body = (await c.req.json<{ text?: string; confirm?: boolean; replaceConflicts?: boolean }>().catch(() => ({}))) as {
    text?: string;
    confirm?: boolean;
    replaceConflicts?: boolean;
  };
  const data = await getRulesData(c.env);
  const category = data.categories.find((item) => item.id === categoryId);
  if (!category) return error('分类不存在。', 404);
  const preview = parseBulkImport(body.text ?? '', []);
  preview.conflicts = (await Promise.all(preview.rules.map(async (rule) => ({ rule, matches: await findRuleConflicts(c.env, rule) })))).filter((item) => item.matches.length);
  if (!body.confirm) return json({ preview });
  if (preview.conflicts.length && !body.replaceConflicts) return c.json({ error: '批量规则与现有规则重复或冲突。', preview }, 409);
  const conflictIds = [...new Set(preview.conflicts.flatMap((item) => item.matches.map((match) => match.id)))];
  if (conflictIds.length) await c.env.DB.batch(conflictIds.map((id) => c.env.DB.prepare('DELETE FROM rules WHERE id = ? AND source_id IS NULL').bind(id)));
  for (const [index, rule] of preview.rules.entries()) {
    await insertRule(c.env, categoryId, rule, Date.now() + index);
  }
  const next = await getRulesOverview(c.env);
  return json({ preview, replaced: conflictIds.length, ...withLinks(c, next) });
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

app.get('/api/icon-packs/content', requireAuth, async (c) => {
  const url = c.req.query('url');
  if (!url) return error('缺少图标包地址。');
  try {
    return json(await getCachedIconPack(c.env, url));
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : '图标包加载失败。', 502);
  }
});

app.post('/api/icon-packs/refresh', requireSessionAuth, persistentRateLimit('icon-pack-refresh', 5), async (c) => {
  const result = await refreshIconPacks(c.env, true);
  return json(result);
});

app.get('/api/service-status', requireSessionAuth, async (c) => {
  const checkedAt = new Date().toISOString();
  const databaseReady = await c.env.DB.ping().catch(() => false);
  let telegram: { status: 'online' | 'offline' | 'unconfigured'; checkedAt: string; username?: string; error?: string } = {
    status: 'unconfigured', checkedAt,
  };
  if (c.env.TELEGRAM?.enabled && c.env.TELEGRAM_CLIENT) {
    try {
      const bot = await c.env.TELEGRAM_CLIENT.getMe();
      telegram = { status: 'online', checkedAt, username: bot.username };
    } catch (cause) {
      telegram = { status: 'offline', checkedAt, error: (cause instanceof Error ? cause.message : '检测失败').slice(0, 160) };
    }
  }
  return json({ checkedAt, services: {
    database: { status: databaseReady ? 'online' : 'offline', checkedAt },
    password: { status: c.env.ADMIN_PASSWORD ? 'configured' : 'unconfigured', checkedAt },
    ruleToken: { status: c.env.RULE_TOKEN ? 'configured' : 'unconfigured', checkedAt },
    telegram,
  } });
});

app.get('/api/settings/manual-rule-optimization', requireSessionAuth, async (c) => {
  return json({ preview: await previewManualRuleOptimization(c.env) });
});

app.post('/api/settings/manual-rule-optimization', requireSessionAuth, async (c) => {
  const result = await optimizeManualRules(c.env);
  return json({ preview: result.preview, ...withLinks(c, result.data) });
});

app.get('/api/links', requireAuth, async (c) => {
  const data = await getRulesOverview(c.env);
  return json({ links: linksByCategory(data, externalRequestUrl(c), c.env.RULE_TOKEN) });
});

app.post('/api/sync', requireAuth, persistentRateLimit('sync-all', 5), async (c) => {
  const results = await syncRuleSources(c.env);
  return json({ results, ...withLinks(c, await getRulesOverview(c.env)) });
});

app.post('/api/categories/:id/sync', requireAuth, persistentRateLimit('sync-category', 10), async (c) => {
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
  // A Telegram Mini App has to load the SPA before it can submit the signed
  // initData and receive its short-lived cookie. The normal browser path still
  // redirects to /admin/login when the first authenticated API request returns
  // 401, while an existing admin or Telegram cookie is accepted immediately.
  return adminApp(c);
});

app.get('/admin/login', (c) => adminApp(c));
app.all('/api/*', (c) => c.notFound());
app.all('/rules/*', (c) => c.notFound());
app.all('/sub/*', (c) => c.notFound());
app.get('*', async (c) => c.env.ASSETS.fetch(c.req.raw));
return app;
}
