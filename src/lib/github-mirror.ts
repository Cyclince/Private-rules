export const GITHUB_MIRROR_PRESETS = [
  'https://cdn.jsdelivr.net',
  'https://fastly.jsdelivr.net',
  'https://testingcf.jsdelivr.net',
] as const;

type GithubFile = { owner: string; repo: string; ref: string; path: string };

function decodedSegments(pathname: string) {
  return pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
}

function fileFromSegments(parts: string[], offset = 0): GithubFile | null {
  const owner = parts[offset];
  const repo = parts[offset + 1]?.replace(/\.git$/i, '');
  const remainder = parts.slice(offset + 2);
  if (!owner || !repo || !remainder.length) return null;
  if (remainder[0] === 'refs' && (remainder[1] === 'heads' || remainder[1] === 'tags')) {
    if (!remainder[2] || !remainder[3]) return null;
    return { owner, repo, ref: remainder[2], path: remainder.slice(3).join('/') };
  }
  if (!remainder[0] || !remainder[1]) return null;
  return { owner, repo, ref: remainder[0], path: remainder.slice(1).join('/') };
}

export function githubFileFromUrl(value: string): GithubFile | null {
  try {
    const url = new URL(value);
    const parts = decodedSegments(url.pathname);
    if (url.hostname === 'raw.githubusercontent.com') return fileFromSegments(parts);
    if (url.hostname === 'github.com' && (parts[2] === 'raw' || parts[2] === 'blob')) {
      return fileFromSegments([parts[0], parts[1], ...parts.slice(3)]);
    }
  } catch { /* Invalid URLs are not GitHub files. */ }
  return null;
}

function encodePath(value: string) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function isJsDelivrBase(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'jsdelivr.net' || hostname.endsWith('.jsdelivr.net');
  } catch { return false; }
}

export function normalizeGithubMirrorUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('GitHub 地址必须使用 HTTP 或 HTTPS');
  if (trimmed.length > 1000) throw new Error('GitHub 地址过长');
  return trimmed.replace(/\/+$/, '');
}

export function rewriteGithubUrl(value: string, mirrorValue: string) {
  const file = githubFileFromUrl(value);
  if (!file || !mirrorValue.trim()) return value;
  const mirror = normalizeGithubMirrorUrl(mirrorValue);
  if (isJsDelivrBase(mirror)) {
    return `${mirror}/gh/${encodeURIComponent(file.owner)}/${encodeURIComponent(file.repo)}@${encodeURIComponent(file.ref)}/${encodePath(file.path)}`;
  }
  const replacements: Record<string, string> = {
    '{url}': value,
    '{owner}': encodeURIComponent(file.owner),
    '{repo}': encodeURIComponent(file.repo),
    '{ref}': encodeURIComponent(file.ref),
    '{path}': encodePath(file.path),
  };
  if (Object.keys(replacements).some((placeholder) => mirror.includes(placeholder))) {
    return Object.entries(replacements).reduce((result, [placeholder, replacement]) => result.replaceAll(placeholder, replacement), mirror);
  }
  return `${mirror}/${value}`;
}

export function sourceNameFromSubscriptionUrl(value: string, fallback = '') {
  try {
    const url = new URL(value);
    const parts = decodedSegments(url.pathname);
    if ((url.hostname === 'raw.githubusercontent.com' || url.hostname === 'github.com') && parts[0]) return parts[0];
    const ghIndex = parts.findIndex((part) => part.toLowerCase() === 'gh');
    if (ghIndex >= 0 && parts[ghIndex + 1]) return parts[ghIndex + 1];
    const embeddedRaw = decodeURIComponent(url.pathname).match(/raw\.githubusercontent\.com\/([^/]+)/i);
    if (embeddedRaw?.[1]) return embeddedRaw[1];
    const filename = parts.at(-1);
    if (filename && filename.includes('.')) return filename.replace(/\.[^.]+$/, '') || filename;
    if (filename) return filename;
    return fallback || url.hostname;
  } catch {
    return fallback || value;
  }
}
