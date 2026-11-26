import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';

describe('shared Hono application', () => {
  it('reports runtime and database health without leaking configuration', async () => {
    const env = { DB: { ping: async () => true }, RUNTIME: 'node', APP_VERSION: '1.0.0' } as Env;
    const response = await createApp().request('/health', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, database: 'ok', runtime: 'node', version: '1.0.0' });
  });

  it('does not let the SPA fallback cover unknown API routes', async () => {
    const env = {
      DB: { ping: async () => true },
      ASSETS: { fetch: async () => new Response('<html>spa</html>') },
    } as Env;
    const response = await createApp().request('/api/missing', {}, env);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('<html>');
  });

  it('serves the 1.1.0 SPA on /admin, /admin/*, and /pwa-install, and redirects /preview* to /admin*', async () => {
    const requestedPaths: string[] = [];
    const env = {
      DB: { ping: async () => true },
      ASSETS: {
        fetch: async (request: Request) => {
          const pathname = new URL(request.url).pathname;
          requestedPaths.push(pathname);
          return new Response(`<html>${pathname}</html>`, { headers: { 'content-type': 'text/html' } });
        },
      },
    } as Env;
    const app = createApp();

    const adminRes = await app.request('/admin', {}, env);
    expect(adminRes.status).toBe(200);
    expect(await adminRes.text()).toContain('<html>/</html>');

    const nestedAdmin = await app.request('/admin/rulesets', {}, env);
    expect(nestedAdmin.status).toBe(200);
    expect(await nestedAdmin.text()).toContain('<html>/</html>');

    const pwaRes = await app.request('/pwa-install', {}, env);
    expect(pwaRes.status).toBe(200);
    expect(await pwaRes.text()).toContain('<html>/</html>');
    expect(requestedPaths).toEqual(['/', '/', '/']);

    const previewRes = await app.request('/preview', {}, env);
    expect(previewRes.status).toBe(302);
    expect(previewRes.headers.get('location')).toBe('/admin');

    const nestedPreview = await app.request('/preview/rulesets?selected=cat_1', {}, env);
    expect(nestedPreview.status).toBe(302);
    expect(nestedPreview.headers.get('location')).toBe('/admin/rulesets?selected=cat_1');
  });
});
