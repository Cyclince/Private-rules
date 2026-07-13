import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppVariables, Env } from './types';
import { authConfigured, checkPassword, createSession, destroySession, isAuthenticated, requireAuth, safeFileName, tokenMatches } from './lib/auth';
import {
  addRule,
  createCategory,
  deleteCategory,
  deleteRule,
  ensureDatabase,
  getRulesData,
  importRulesData,
  insertRule,
  saveSettings,
  updateCategory,
  updateRule,
} from './lib/db';
import { parseBulkImport } from './lib/parser';
import { error, json, textFile } from './lib/response';
import { linksByCategory } from './lib/links';
import { resolveFile } from './lib/formatters';
import { syncRuleSources } from './lib/sync';
import { searchGeoSources } from './lib/geosite';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

app.use('*', async (c, next) => {
  await ensureDatabase(c.env);
  await next();
});

function withLinks(c: AppContext, data: Awaited<ReturnType<typeof getRulesData>>) {
  return { data, links: linksByCategory(data, c.req.url, c.env.RULE_TOKEN) };
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

app.get('/api/categories', requireAuth, async (c) => json(withLinks(c, await getRulesData(c.env))));

app.get('/api/geo/search', requireAuth, async (c) => json({ results: await searchGeoSources(c.req.query('q') ?? '') }));

app.post('/api/categories', requireAuth, async (c) => {
  const input = await c.req.json<{ name?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[] }>().catch(() => ({} as { name?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[] }));
  let data = await createCategory(c.env, input);
  if (input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length) {
    const created = data.categories.find((category) => category.name === input.name) ?? [...data.categories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (created) await syncRuleSources(c.env, created.id);
    data = await getRulesData(c.env);
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
  const next = await getRulesData(c.env);
  return json({ preview, ...withLinks(c, next) });
});

app.get('/api/settings', requireAuth, async (c) => {
  const data = await getRulesData(c.env);
  return json({ settings: data.settings, meta: data.meta });
});

app.patch('/api/settings', requireAuth, async (c) => {
  const input = await c.req.json().catch(() => ({}));
  await saveSettings(c.env, input);
  return json(withLinks(c, await getRulesData(c.env)));
});

app.get('/api/links', requireAuth, async (c) => {
  const data = await getRulesData(c.env);
  return json({ links: linksByCategory(data, c.req.url, c.env.RULE_TOKEN) });
});

app.post('/api/sync', requireAuth, async (c) => {
  const results = await syncRuleSources(c.env);
  return json({ results, ...withLinks(c, await getRulesData(c.env)) });
});

app.post('/api/categories/:id/sync', requireAuth, async (c) => {
  const results = await syncRuleSources(c.env, c.req.param('id'));
  return json({ results, ...withLinks(c, await getRulesData(c.env)) });
});

app.get('/api/data', requireAuth, async (c) => json(await getRulesData(c.env)));

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
app.get('*', async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ensureDatabase(env).then(() => syncRuleSources(env, undefined, false)).then(() => undefined));
  },
};
