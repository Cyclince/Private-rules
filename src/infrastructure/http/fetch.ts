import { AppError } from '../../shared/errors';
import { redactString } from '../logging/logger';

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_FETCH_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 0;

export type DnsResolver = (hostname: string) => Promise<string[]>;

export type SafeFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  timeoutMs?: number;
  maxBytes?: number;
  /** Defaults to `0` (redirects forbidden, design §14). When > 0, each hop is validated. */
  maxRedirects?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Custom DNS resolver; defaults to Node `dns/promises` lookup on real Node network calls. */
  resolveDns?: DnsResolver;
};

const NATIVE_FETCH = globalThis.fetch;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function parseIpv4(hostname: string): number[] | null {
  const octets = hostname.split('.');
  if (octets.length !== 4) return null;
  const parsed = octets.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return parsed;
}

function isBlockedIpv4Octets(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // 0.0.0.0/8 ("this" network)
    a === 10 || // 10.0.0.0/8 (RFC 1918)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
    a === 127 || // 127.0.0.0/8 (loopback)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local / cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (RFC 1918)
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 (IETF protocol assignments)
    (a === 192 && b === 168) || // 192.168.0.0/16 (RFC 1918)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 (benchmarking)
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  );
}

function parseIpv6ToBigInt(raw: string): bigint | null {
  const address = raw
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  if (!address.includes(':') || (address.match(/::/g)?.length ?? 0) > 1) return null;

  // Handle dotted-quad IPv4 suffix inside IPv6 (e.g. ::ffff:127.0.0.1)
  let normalized = address;
  const lastColon = normalized.lastIndexOf(':');
  const tail = normalized.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = parseIpv4(tail);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const [left = '', right = ''] = normalized.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < (normalized.includes('::') ? 1 : 0)) return null;
  const parts = normalized.includes('::')
    ? [...leftParts, ...Array<string>(missing).fill('0'), ...rightParts]
    : leftParts;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.reduce((acc, part) => (acc << 16n) | BigInt(`0x${part}`), 0n);
}

function ipv4OctetsFromBigInt(value: bigint): number[] {
  return [
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  ];
}

/**
 * Returns true if `ip` is a loopback, private, link-local, CGNAT, multicast,
 * unspecified, or IPv4-mapped/NAT64-embedded private address.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const clean = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const ipv4 = parseIpv4(clean);
  if (ipv4) return isBlockedIpv4Octets(ipv4);

  const ipv6 = parseIpv6ToBigInt(clean);
  if (ipv6 === null) return false;

  if (ipv6 === 0n || ipv6 === 1n) return true; // :: and ::1
  if (ipv6 >> 121n === 0x7en) return true; // fc00::/7 (unique local)
  if (ipv6 >> 118n === 0x3fan) return true; // fe80::/10 (link-local)
  if (ipv6 >> 120n === 0xffn) return true; // ff00::/8 (multicast)
  if (ipv6 >> 64n === 0x0100000000000000n) return true; // 100::/64 (discard)

  // ::ffff:0:0/96 (IPv4-mapped IPv6) and 64:ff9b::/96 (NAT64 well-known prefix)
  const prefix96 = ipv6 >> 32n;
  if (prefix96 === 0xffffn || prefix96 === 0x0064ff9b0000000000000000n) {
    return isBlockedIpv4Octets(ipv4OctetsFromBigInt(ipv6 & 0xffffffffn));
  }

  return false;
}

function isIpLiteral(hostname: string): boolean {
  return parseIpv4(hostname) !== null || parseIpv6ToBigInt(hostname) !== null;
}

/**
 * Synchronous URL-level SSRF validation (protocol, credentials, hostnames,
 * IPv4/IPv6 literals). Strips URL fragments.
 */
export function validateRemoteSourceUrl(raw: string): string {
  const input = raw.trim();
  if (!input || input.length > 2048) throw new AppError('VALIDATION_FAILED', '远程来源 URL 格式错误。');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('VALIDATION_FAILED', '远程来源 URL 格式错误。');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('VALIDATION_FAILED', '远程来源仅支持 HTTP 或 HTTPS。');
  }
  if (url.username || url.password) {
    throw new AppError('VALIDATION_FAILED', '远程来源 URL 不得包含认证信息。');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.goog' ||
    isBlockedIpAddress(hostname)
  ) {
    throw new AppError('VALIDATION_FAILED', '远程来源地址被 SSRF 安全策略拒绝。');
  }
  url.hash = '';
  return url.toString();
}

async function resolveWithNodeDns(hostname: string): Promise<string[]> {
  if (typeof process === 'undefined' || !process.versions?.node) return [];
  const dns = await import('node:dns/promises');
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function assertHostnameNotPrivate(hostname: string, resolver?: DnsResolver): Promise<void> {
  if (isIpLiteral(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new AppError('VALIDATION_FAILED', '远程来源地址被 SSRF 安全策略拒绝。');
    }
    return;
  }
  if (!resolver) return;
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new AppError('UPSTREAM_FAILED', '无法解析远程来源域名。');
  }
  if (addresses.length === 0) {
    throw new AppError('UPSTREAM_FAILED', '远程来源域名未返回有效 IP 地址。');
  }
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new AppError('VALIDATION_FAILED', '远程来源解析到内网或保留地址，已被 SSRF 安全策略拒绝。');
    }
  }
}

async function readBodyBytesWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppError('UPSTREAM_FAILED', `上游响应超过大小限制（${maxBytes} 字节）。`);
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new AppError('UPSTREAM_FAILED', `上游响应超过大小限制（${maxBytes} 字节）。`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppError('UPSTREAM_FAILED', `上游响应超过大小限制（${maxBytes} 字节）。`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export type SafeFetchResult = {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: Uint8Array;
};

/**
 * Unified SSRF-safe HTTP client (design §14):
 *   - Validates URL protocol, credentials, hostname, and IPv4/IPv6 ranges
 *   - Resolves DNS and rejects private/reserved targets on Node (or via injected resolver)
 *   - Forbids redirects by default (`maxRedirects = 0`), or validates every hop when enabled
 *   - Enforces timeout (default 15s) and streaming response size limit (default 20MB)
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const dnsResolver = options.resolveDns ?? (fetchFn === NATIVE_FETCH ? resolveWithNodeDns : undefined);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    let currentUrl = validateRemoteSourceUrl(rawUrl);
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const parsed = new URL(currentUrl);
      await assertHostnameNotPrivate(parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ''), dnsResolver);

      let response: Response;
      try {
        response = await fetchFn(currentUrl, {
          method: options.method ?? 'GET',
          headers: options.headers,
          body: options.body,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new AppError('UPSTREAM_FAILED', `上游请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒）。`);
        }
        throw new AppError('UPSTREAM_FAILED', cause instanceof Error ? redactString(cause.message) : '上游请求失败。');
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (maxRedirects <= 0) {
          throw new AppError('UPSTREAM_FAILED', '远程来源禁止重定向。');
        }
        if (hop >= maxRedirects) {
          throw new AppError('UPSTREAM_FAILED', `远程来源重定向次数超过上限（${maxRedirects}）。`);
        }
        if (!location) {
          throw new AppError('UPSTREAM_FAILED', '上游重定向缺少 Location 响应头。');
        }
        currentUrl = validateRemoteSourceUrl(new URL(location, currentUrl).toString());
        continue;
      }

      const bytes = await readBodyBytesWithLimit(response, maxBytes);
      return {
        url: currentUrl,
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        bytes,
      };
    }

    throw new AppError('UPSTREAM_FAILED', '远程来源重定向次数超过上限。');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult & { text: string }> {
  const result = await safeFetch(rawUrl, options);
  return { ...result, text: new TextDecoder().decode(result.bytes) };
}

export async function safeFetchJson<T = unknown>(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult & { data: T }> {
  const result = await safeFetchText(rawUrl, options);
  try {
    return { ...result, data: JSON.parse(result.text) as T };
  } catch {
    throw new AppError('UPSTREAM_FAILED', '上游返回的 JSON 格式无效。');
  }
}
