import { createAdaptorServer, type Http2Bindings, type HttpBindings } from '@hono/node-server';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeAssetsAdapter } from '../../src/infrastructure/assets/node';
import { SqliteDatabaseAdapter } from '../../src/infrastructure/database/sqlite/adapter';
import { migrateSqliteDatabase } from '../../src/infrastructure/database/sqlite/migrations';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';

const OUTSIDE_SECRET = 'OUTSIDE_DIST_CLIENT_SECRET_PAYLOAD';
const SPA_HTML = '<!doctype html><html><body>SPA_INDEX_FALLBACK</body></html>';

function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, method: 'GET', path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: String(res.headers['content-type'] ?? ''),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Node runtime static asset serving (@hono/node-server 2.x + NodeAssetsAdapter)', () => {
  let directory: string;
  let database: SqliteDatabaseAdapter;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'private-rules-node-static-'));
    const distDir = join(directory, 'dist');
    const clientDir = join(distDir, 'client');
    const siblingDir = join(distDir, 'client-secret');

    await mkdir(join(clientDir, 'assets'), { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await writeFile(join(directory, 'secret.txt'), OUTSIDE_SECRET);
    await writeFile(join(distDir, 'secret.txt'), OUTSIDE_SECRET);
    await writeFile(join(siblingDir, 'secret.txt'), OUTSIDE_SECRET);
    await writeFile(join(clientDir, 'index.html'), SPA_HTML);
    await writeFile(join(clientDir, 'assets', 'app-12345678.js'), "console.log('ok');");

    database = new SqliteDatabaseAdapter(join(directory, 'static-test.db'));
    await migrateSqliteDatabase(database);

    const env: Env = {
      DB: database,
      ASSETS: new NodeAssetsAdapter(clientDir),
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'test-rule-token',
      RUNTIME: 'node',
    };

    const app = createApp();
    server = createAdaptorServer({
      fetch: (request, bindings: HttpBindings | Http2Bindings) =>
        app.fetch(request, { ...env, CLIENT_ADDRESS: bindings?.incoming?.socket?.remoteAddress }),
    }) as Server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves built static files and SPA routes within dist/client', async () => {
    const asset = await rawGet(port, '/assets/app-12345678.js');
    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain('text/javascript');
    expect(asset.body).toBe("console.log('ok');");

    const spa = await rawGet(port, '/admin/login');
    expect(spa.status).toBe(200);
    expect(spa.contentType).toContain('text/html');
    expect(spa.body).toBe(SPA_HTML);
  });

  it('never escapes dist/client on double-encoded, single-encoded, sibling-prefix, backslash, or malformed paths', async () => {
    const blockedPaths = [
      '/%252e%252e/secret.txt',
      '/%252e%252e%252fsecret.txt',
      '/%252e%252e/%252e%252e/secret.txt',
      '/assets/%252e%252e/%252e%252e/secret.txt',
      '/%252e%252e/client-secret/secret.txt',
      '/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/%2e%2e/client-secret/secret.txt',
      '/%2e%2e%2fclient-secret%2fsecret.txt',
      '/%2e%2e%5csecret.txt',
      '/%E0%A4%A/secret.txt',
    ];

    for (const rawPath of blockedPaths) {
      const response = await rawGet(port, rawPath);
      expect(response.status, `expected 404 for ${rawPath}`).toBe(404);
      expect(response.body).not.toContain(OUTSIDE_SECRET);
    }

    // Raw backslash is rejected by @hono/node-server 2.1.6+ with 400 Bad Request
    const backslashResponse = await rawGet(port, '/..\\secret.txt');
    expect([400, 404]).toContain(backslashResponse.status);
    expect(backslashResponse.body).not.toContain(OUTSIDE_SECRET);

    // Traversal payloads under SPA prefix may return 404 or SPA fallback, never outside files
    for (const spaTraversal of ['/admin/%252e%252e/%252e%252e/secret.txt', '/admin/..%2f..%2fsecret.txt']) {
      const response = await rawGet(port, spaTraversal);
      expect([200, 404]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body).toBe(SPA_HTML);
      }
      expect(response.body).not.toContain(OUTSIDE_SECRET);
    }
  });
});
