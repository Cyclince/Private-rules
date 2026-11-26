/**
 * Production bundle-size reporter and CI budget gate (design §13.1).
 *
 * Parses `dist/client/index.html`, walks static ESM imports to compute exact
 * first-screen JS/CSS totals and per-route lazy increments, and exits non-zero
 * if any budget is exceeded:
 *   - First-screen JS: <= 120 kB gzip
 *   - Single-route JS increment: <= 60 kB gzip
 *   - CSS total: <= 25 kB gzip
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const FIRST_SCREEN_JS_BUDGET_KB = 120;
const SINGLE_ROUTE_JS_BUDGET_KB = 60;
const CSS_BUDGET_KB = 25;

const DIST_CLIENT = resolve(process.cwd(), 'dist/client');
const ASSETS_DIR = join(DIST_CLIENT, 'assets');

type FileMetric = {
  file: string;
  rawBytes: number;
  gzipBytes: number;
};

const metricCache = new Map<string, FileMetric>();

function measureAsset(file: string): FileMetric {
  const cached = metricCache.get(file);
  if (cached) return cached;
  const content = readFileSync(join(ASSETS_DIR, file));
  const metric: FileMetric = {
    file,
    rawBytes: content.length,
    gzipBytes: gzipSync(content, { level: 9 }).length,
  };
  metricCache.set(file, metric);
  return metric;
}

function parseStaticImports(file: string): string[] {
  const source = readFileSync(join(ASSETS_DIR, file), 'utf8');
  const imports = new Set<string>();
  for (const match of source.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) {
    imports.add(match[1]);
  }
  return [...imports];
}

function collectStaticGraph(roots: Iterable<string>): Set<string> {
  const visited = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of parseStaticImports(current)) {
      if (!visited.has(dep)) stack.push(dep);
    }
  }
  return visited;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1000).toFixed(2)} kB`;
}

function sumGzipKb(files: Iterable<string>): number {
  let total = 0;
  for (const file of files) total += measureAsset(file).gzipBytes;
  return total / 1000;
}

function totalDirectoryBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += totalDirectoryBytes(full);
    else total += statSync(full).size;
  }
  return total;
}

function findRouteChunks(entryJsFiles: Set<string>): Array<{ route: string; file: string }> {
  const knownRoutes = ['index', 'login', 'rulesets', 'settings', 'templates', 'publications', 'PwaInstallPage'];
  const discovered = new Map<string, string>();
  const allAssets = new Set(readdirSync(ASSETS_DIR));

  for (const entryFile of entryJsFiles) {
    const source = readFileSync(join(ASSETS_DIR, entryFile), 'utf8');
    for (const match of source.matchAll(/["']assets\/([^"']+\.js)["']|["']\.\/([^"']+\.js)["']/g)) {
      const candidate = match[1] ?? match[2];
      if (!candidate || !allAssets.has(candidate) || entryJsFiles.has(candidate)) continue;
      for (const route of knownRoutes) {
        if (candidate.startsWith(`${route}-`) && !discovered.has(route)) {
          if (route === 'index' && measureAsset(candidate).rawBytes < 500) continue;
          discovered.set(route, candidate);
        }
      }
    }
  }

  return knownRoutes.filter((route) => discovered.has(route)).map((route) => ({ route, file: discovered.get(route)! }));
}

function main() {
  const html = readFileSync(join(DIST_CLIENT, 'index.html'), 'utf8');

  const directJs = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  const directCss = [...html.matchAll(/href="\/assets\/([^"]+\.css)"/g)].map((m) => m[1]);

  if (directJs.length === 0) {
    console.error('[bundle-size] No entry JS found in dist/client/index.html. Run `pnpm build` first.');
    process.exit(1);
  }

  const shellJs = collectStaticGraph(directJs);
  const routes = findRouteChunks(shellJs);
  const violations: string[] = [];

  console.info('\n=== Private Rules (/admin) Bundle Size Report ===\n');

  console.info('Entry Shell JS:');
  for (const file of [...shellJs].sort()) {
    const m = measureAsset(file);
    console.info(
      `  ${m.file.padEnd(44)} raw ${formatKb(m.rawBytes).padStart(9)} | gzip ${formatKb(m.gzipBytes).padStart(8)}`,
    );
  }
  const shellGzipKb = sumGzipKb(shellJs);
  console.info(`  -> Entry Shell JS total: ${shellGzipKb.toFixed(2)} kB gzip\n`);

  console.info('CSS:');
  for (const file of directCss) {
    const m = measureAsset(file);
    console.info(
      `  ${m.file.padEnd(44)} raw ${formatKb(m.rawBytes).padStart(9)} | gzip ${formatKb(m.gzipBytes).padStart(8)}`,
    );
  }
  const cssGzipKb = sumGzipKb(directCss);
  console.info(`  -> CSS total: ${cssGzipKb.toFixed(2)} kB gzip (budget <= ${CSS_BUDGET_KB} kB)\n`);
  if (cssGzipKb > CSS_BUDGET_KB) {
    violations.push(`CSS ${cssGzipKb.toFixed(2)} kB exceeds ${CSS_BUDGET_KB} kB gzip budget`);
  }

  console.info('Lazy Route Increments:');
  let dashboardFirstScreenKb = shellGzipKb;
  let loginFirstScreenKb = shellGzipKb;

  for (const { route, file } of routes) {
    const graph = collectStaticGraph([file]);
    const incrementFiles = [...graph].filter((dep) => !shellJs.has(dep)).sort();
    const incrementKb = sumGzipKb(incrementFiles);
    if (route === 'index') dashboardFirstScreenKb = shellGzipKb + incrementKb;
    if (route === 'login') loginFirstScreenKb = shellGzipKb + incrementKb;

    const routeLabel = route === 'index' ? '/admin/' : route === 'PwaInstallPage' ? '/pwa-install' : `/admin/${route}`;
    console.info(
      `  ${routeLabel.padEnd(24)} +${incrementKb.toFixed(2).padStart(6)} kB gzip (${incrementFiles.length} chunk${incrementFiles.length === 1 ? '' : 's'}: ${incrementFiles.join(', ')})`,
    );
    if (incrementKb > SINGLE_ROUTE_JS_BUDGET_KB) {
      violations.push(
        `Route ${routeLabel} increment ${incrementKb.toFixed(2)} kB exceeds ${SINGLE_ROUTE_JS_BUDGET_KB} kB gzip budget`,
      );
    }
  }

  console.info('\nFirst-Screen JS Totals:');
  console.info(
    `  /admin/          ${dashboardFirstScreenKb.toFixed(2)} kB gzip (budget <= ${FIRST_SCREEN_JS_BUDGET_KB} kB)`,
  );
  console.info(
    `  /admin/login     ${loginFirstScreenKb.toFixed(2)} kB gzip (budget <= ${FIRST_SCREEN_JS_BUDGET_KB} kB)`,
  );
  console.info(`  dist/client total (all assets): ${(totalDirectoryBytes(DIST_CLIENT) / 1024).toFixed(1)} KiB`);

  if (dashboardFirstScreenKb > FIRST_SCREEN_JS_BUDGET_KB) {
    violations.push(
      `First-screen JS (/admin/) ${dashboardFirstScreenKb.toFixed(2)} kB exceeds ${FIRST_SCREEN_JS_BUDGET_KB} kB gzip budget`,
    );
  }
  if (loginFirstScreenKb > FIRST_SCREEN_JS_BUDGET_KB) {
    violations.push(
      `First-screen JS (/admin/login) ${loginFirstScreenKb.toFixed(2)} kB exceeds ${FIRST_SCREEN_JS_BUDGET_KB} kB gzip budget`,
    );
  }

  console.info('');
  if (violations.length > 0) {
    for (const violation of violations) console.error(`[FAIL] ${violation}`);
    process.exit(1);
  }
  console.info('[PASS] All bundle-size budgets satisfied.');
}

main();
