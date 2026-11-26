import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { AssetsPort } from '../../application/ports/assets';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export class NodeAssetsAdapter implements AssetsPort {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  async fetch(request: Request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const requested =
      pathname === '/' || pathname.startsWith('/admin')
        ? 'index.html'
        : pathname === '/preview' || pathname.startsWith('/preview/')
          ? 'preview.html'
          : pathname.replace(/^\/+/, '');
    const candidate = resolve(join(this.root, normalize(requested)));
    if (!candidate.startsWith(this.root)) return new Response('Not Found', { status: 404 });
    try {
      if (!(await stat(candidate)).isFile()) throw new Error('not-file');
      const extension = extname(candidate).toLowerCase();
      const headers = new Headers({ 'content-type': contentTypes[extension] ?? 'application/octet-stream' });
      headers.set('cache-control', extension === '.html' ? 'no-store' : /-[a-zA-Z0-9_-]{8,}\./.test(candidate) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      return new Response(await readFile(candidate), { headers });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  }
}
