import type { GeoSourceSuggestion } from '../types/domain-rules';
import { rewriteGithubUrl } from './github-mirror';

const REPOSITORY = 'https://raw.githubusercontent.com/v2fly/domain-list-community/master/data';
const TREE_API = 'https://api.github.com/repos/v2fly/domain-list-community/git/trees/master?recursive=1';
const GEOIP_TREE_API = 'https://api.github.com/repos/Loyalsoldier/geoip/git/trees/release?recursive=1';
let cachedNames: { at: number; names: string[] } | undefined;
let cachedGeoipNames: { at: number; names: string[] } | undefined;

async function geositeNames() {
  if (cachedNames && Date.now() - cachedNames.at < 10 * 60_000) return cachedNames.names;
  const response = await fetch(TREE_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Private-rules-worker' } });
  if (!response.ok) throw new Error(`GeoSite 索引返回 HTTP ${response.status}`);
  const payload = await response.json<{ tree?: Array<{ path?: string; type?: string }> }>();
  const names = (payload.tree ?? [])
    .filter((item) => item.type === 'blob' && item.path?.startsWith('data/') && !item.path.slice(5).includes('/'))
    .map((item) => item.path!.slice(5));
  cachedNames = { at: Date.now(), names };
  return names;
}

async function geoipNames() {
  if (cachedGeoipNames && Date.now() - cachedGeoipNames.at < 10 * 60_000) return cachedGeoipNames.names;
  const response = await fetch(GEOIP_TREE_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Private-rules-worker' } });
  if (!response.ok) throw new Error(`GeoIP 索引返回 HTTP ${response.status}`);
  const payload = await response.json<{ tree?: Array<{ path?: string; type?: string }> }>();
  const names = (payload.tree ?? []).filter((item) => item.type === 'blob' && /^dat\/[^/]+\.dat$/i.test(item.path ?? '')).map((item) => item.path!.slice(4, -4));
  cachedGeoipNames = { at: Date.now(), names };
  return names;
}

export async function searchGeoSources(rawQuery: string): Promise<GeoSourceSuggestion[]> {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const terms = query.split(/[\s_-]+/).filter(Boolean);
  const matches = (await geositeNames()).filter((name) => {
    const tokens = name.split(/[-_!@.]+/).filter(Boolean);
    return terms.every((term) => tokens.some((token) => token.startsWith(term)));
  });
  const score = (name: string) => {
    if (name === query) return 0;
    if (name === `category-${query}-!cn`) return 1;
    if (name === `category-${query}`) return 2;
    if (name.startsWith('category-') && name.includes(query)) return 3;
    if (name.startsWith(query)) return 4;
    return 5;
  };
  const geositeResults: GeoSourceSuggestion[] = matches.sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, 18).map((name) => ({
    name,
    sourceType: 'geosite',
    recommended: name.startsWith('category-'),
    description: name.endsWith('-!cn') ? '聚合分类，排除中国大陆相关域名' : name.startsWith('category-') ? '社区维护的聚合分类' : '独立 GeoSite 规则集',
  }));
  const geoipResults: GeoSourceSuggestion[] = (await geoipNames()).filter((name) => name.split(/[-_!]+/).some((token) => token.startsWith(query))).slice(0, 12).map((name) => ({
    name,
    sourceType: 'geoip',
    recommended: !/^[a-z]{2}$/i.test(name),
    description: /^[a-z]{2}$/i.test(name) ? '国家或地区 IP 地址集合' : '服务专用 IP 地址集合',
  }));
  return [...geositeResults, ...geoipResults].sort((a, b) => {
    const aExact = a.name === query ? 0 : 1;
    const bExact = b.name === query ? 0 : 1;
    return aExact - bExact || a.name.localeCompare(b.name) || a.sourceType.localeCompare(b.sourceType);
  }).slice(0, 24);
}

function normalizeGeositeLine(line: string, requiredAttrs: string[], excludedAttrs: string[]) {
  const value = line.replace(/\s+#.*$/, '').trim();
  if (!value || value.startsWith('#') || value.startsWith('regexp:')) return '';
  const parts = value.split(/\s+/);
  const clean = parts[0];
  const attrs = new Set(parts.slice(1).filter((part) => part.startsWith('@')).map((part) => part.slice(1)));
  if (requiredAttrs.some((attr) => !attrs.has(attr)) || excludedAttrs.some((attr) => attrs.has(attr))) return '';
  if (clean.startsWith('domain:')) return `DOMAIN-SUFFIX,${clean.slice(7)}`;
  if (clean.startsWith('full:')) return `DOMAIN,${clean.slice(5)}`;
  if (clean.startsWith('keyword:')) return `DOMAIN-KEYWORD,${clean.slice(8)}`;
  if (/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(clean)) return `DOMAIN-SUFFIX,${clean}`;
  return '';
}

async function resolveGeosite(name: string, visited: Set<string>, depth: number, mirrorUrl: string, requiredAttrs: string[] = [], excludedAttrs: string[] = []): Promise<string[]> {
  const visitKey = `${name}|${requiredAttrs.join(',')}|${excludedAttrs.join(',')}`;
  if (visited.has(visitKey) || depth > 10) return [];
  visited.add(visitKey);
  const response = await fetch(rewriteGithubUrl(`${REPOSITORY}/${encodeURIComponent(name)}`, mirrorUrl), { headers: { accept: 'text/plain' } });
  if (!response.ok) throw new Error(`GeoSite ${name} 返回 HTTP ${response.status}`);
  const text = await response.text();
  const lines = text.split(/\r?\n/);
  const includes = lines.map((line) => line.replace(/\s+#.*$/, '').trim()).filter((line) => line.startsWith('include:')).map((line) => {
    const parts = line.split(/\s+/);
    return {
      name: parts[0].slice(8),
      required: parts.slice(1).filter((part) => part.startsWith('@') && !part.startsWith('@-')).map((part) => part.slice(1)),
      excluded: parts.slice(1).filter((part) => part.startsWith('@-')).map((part) => part.slice(2)),
    };
  });
  const nested = await Promise.all(includes.map((include) => resolveGeosite(include.name, visited, depth + 1, mirrorUrl, include.required, include.excluded)));
  return [...lines.map((line) => normalizeGeositeLine(line, requiredAttrs, excludedAttrs)).filter(Boolean), ...nested.flat()];
}

export async function loadGeositeRules(name: string, mirrorUrl = '') {
  const rules = await resolveGeosite(name, new Set(), 0, mirrorUrl);
  return [...new Set(rules)].join('\n');
}
