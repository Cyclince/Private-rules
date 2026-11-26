import { parse as parseYaml } from 'yaml';
import { detectNodeRegions, isInfoNode } from './filter';

export const SUPPORTED_NODE_PROTOCOLS = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'] as const;
export type SupportedNodeProtocol = (typeof SUPPORTED_NODE_PROTOCOLS)[number];

/** Maximum candidate entries processed from a single subscription by default. */
export const DEFAULT_MAX_SUBSCRIPTION_ENTRIES = 1000;

/** Maximum detailed skipped-entry records kept in the compatibility report. */
const MAX_REPORT_SKIPPED_DETAILS = 100;

export type NodeTlsConfig = {
  enabled: boolean;
  serverName?: string;
  insecure?: boolean;
  alpn?: string[];
  fingerprint?: string;
  reality?: {
    publicKey: string;
    shortId?: string;
  };
};

export type NodeTransportConfig =
  | {
      type: 'ws';
      path?: string;
      headers?: Record<string, string>;
      maxEarlyData?: number;
      earlyDataHeaderName?: string;
    }
  | {
      type: 'grpc';
      serviceName?: string;
    }
  | {
      type: 'http';
      host?: string[];
      path?: string;
      method?: string;
      headers?: Record<string, string>;
    }
  | {
      type: 'httpupgrade';
      host?: string;
      path?: string;
      headers?: Record<string, string>;
    };

export type ParsedNodeBase = {
  name: string;
  type: SupportedNodeProtocol;
  server: string;
  port: number;
  udp?: boolean;
  tfo?: boolean;
};

export type ShadowsocksNode = ParsedNodeBase & {
  type: 'ss';
  cipher: string;
  password: string;
  plugin?: string;
  pluginOpts?: Record<string, string | boolean | number>;
};

export type VmessNode = ParsedNodeBase & {
  type: 'vmess';
  uuid: string;
  alterId: number;
  security: string;
  tls?: NodeTlsConfig;
  transport?: NodeTransportConfig;
  packetEncoding?: string;
};

export type VlessNode = ParsedNodeBase & {
  type: 'vless';
  uuid: string;
  flow?: string;
  encryption?: string;
  tls?: NodeTlsConfig;
  transport?: NodeTransportConfig;
  packetEncoding?: string;
};

export type TrojanNode = ParsedNodeBase & {
  type: 'trojan';
  password: string;
  tls?: NodeTlsConfig;
  transport?: NodeTransportConfig;
};

export type Hysteria2Node = ParsedNodeBase & {
  type: 'hysteria2';
  password: string;
  obfs?: {
    type: string;
    password?: string;
  };
  upMbps?: number;
  downMbps?: number;
  ports?: string;
  tls?: NodeTlsConfig;
};

export type TuicNode = ParsedNodeBase & {
  type: 'tuic';
  uuid: string;
  password: string;
  congestionControl?: string;
  udpRelayMode?: string;
  zeroRttHandshake?: boolean;
  disableSni?: boolean;
  tls?: NodeTlsConfig;
};

export type ParsedNode = ShadowsocksNode | VmessNode | VlessNode | TrojanNode | Hysteria2Node | TuicNode;

/** Safe node preview projection — contains NO server, port, password, UUID, or TLS keys. */
export type NodePreviewItem = {
  name: string;
  protocol: SupportedNodeProtocol;
  regions: string[];
  isInfo: boolean;
};

export type SubscriptionFormat = 'clash-yaml' | 'base64-uri' | 'uri-list' | 'mixed' | 'empty' | 'unknown';

export type SkippedNodeReason = 'unsupported_protocol' | 'malformed' | 'limit_exceeded';

export type SkippedNodeEntry = {
  index: number;
  reason: SkippedNodeReason;
  protocol?: string;
  name?: string;
  message: string;
};

export type NodeParseReport = {
  format: SubscriptionFormat;
  totalEntries: number;
  parsedCount: number;
  skippedCount: number;
  truncated: boolean;
  truncatedCount: number;
  protocolCounts: Partial<Record<SupportedNodeProtocol, number>>;
  unsupportedProtocols: Record<string, number>;
  malformedCount: number;
  skipped: SkippedNodeEntry[];
};

export type ParseSubscriptionOptions = {
  /** Maximum candidate entries to parse before truncating (default: 1000). */
  maxEntries?: number;
};

export type ParseSubscriptionResult = {
  nodes: ParsedNode[];
  report: NodeParseReport;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEME_LINE_PATTERN = /^([a-z][a-z0-9+.-]{0,31}):\/\//i;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

const PROTOCOL_ALIASES: Record<string, SupportedNodeProtocol> = {
  ss: 'ss',
  shadowsocks: 'ss',
  vmess: 'vmess',
  vless: 'vless',
  trojan: 'trojan',
  hysteria2: 'hysteria2',
  hy2: 'hysteria2',
  tuic: 'tuic',
};

function normalizeProtocol(raw: string): SupportedNodeProtocol | null {
  return PROTOCOL_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function sanitizeProtocolLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+._-]/g, '')
    .slice(0, 32);
  return cleaned || 'unknown';
}

function sanitizeNodeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 256);
}

function safeDecodeUriComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function decodeBase64Utf8(raw: string): string | null {
  const compact = raw.replace(/\s+/g, '');
  if (!compact || !/^[A-Za-z0-9+/_-]+=*$/.test(compact)) return null;
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
  const unpadded = normalized.replace(/=+$/, '');
  if (!unpadded || unpadded.length % 4 === 1) return null;
  const padded = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function parseServer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1).trim();
  }
  if (!value || value.length > 255) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f/?#@]/.test(value)) return null;
  return value;
}

function parsePort(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 65535 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d{1,5}$/.test(trimmed)) return null;
    const num = Number(trimmed);
    return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : null;
  }
  return null;
}

function parseUuid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function parseNonEmptyString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(/[\r\n\0]/g, '').trim();
  return trimmed ? trimmed : null;
}

function parseBooleanFlag(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  if (typeof raw === 'string') {
    const lower = raw.trim().toLowerCase();
    if (lower === '1' || lower === 'true' || lower === 'yes') return true;
    if (lower === '0' || lower === 'false' || lower === 'no') return false;
  }
  return undefined;
}

function parseNonNegativeInt(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const num = Number(trimmed);
    return Number.isSafeInteger(num) && num >= 0 ? num : null;
  }
  return null;
}

function parseMbps(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === 'string') {
    const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mbps|m)?$/i);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return Math.round(value);
    }
  }
  return undefined;
}

function parseAlpnList(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const items = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  if (typeof raw === 'string') {
    const items = raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function parseStringRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k) continue;
    if (typeof value === 'string' && value.trim()) {
      out[k] = value.trim();
      count += 1;
    } else if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (first) {
        out[k] = first.trim();
        count += 1;
      }
    }
  }
  return count > 0 ? out : undefined;
}

function parseHostPort(raw: string): { server: string; port: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let hostPart: string;
  let portPart: string;
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    if (closeIdx === -1 || trimmed[closeIdx + 1] !== ':') return null;
    hostPart = trimmed.slice(1, closeIdx);
    portPart = trimmed.slice(closeIdx + 2);
  } else {
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx === -1) return null;
    hostPart = trimmed.slice(0, colonIdx);
    portPart = trimmed.slice(colonIdx + 1);
  }

  const server = parseServer(hostPart);
  const port = parsePort(portPart);
  if (!server || port === null) return null;
  return { server, port };
}

type SplitUriParts = {
  userinfo: string;
  server: string;
  port: number;
  params: URLSearchParams;
  fragment: string | null;
};

/**
 * Splits a standard proxy URI (`scheme://userinfo@host:port[/path][?query][#fragment]`)
 * without WHATWG special-scheme port normalization quirks (e.g. preserving port 80/443).
 */
function splitProxyUri(uri: string, schemeLength: number): SplitUriParts | null {
  let rest = uri.slice(schemeLength + 3);
  let fragment: string | null = null;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    fragment = sanitizeNodeName(safeDecodeUriComponent(rest.slice(hashIdx + 1)));
    rest = rest.slice(0, hashIdx);
  }

  let queryStr = '';
  const queryIdx = rest.indexOf('?');
  if (queryIdx !== -1) {
    queryStr = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }

  // Strip optional path segment after authority
  const slashIdx = rest.indexOf('/');
  const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const atIdx = authority.lastIndexOf('@');
  if (atIdx === -1) return null;

  const userinfo = authority.slice(0, atIdx);
  const hostPort = parseHostPort(authority.slice(atIdx + 1));
  if (!hostPort) return null;

  return {
    userinfo,
    server: hostPort.server,
    port: hostPort.port,
    params: new URLSearchParams(queryStr),
    fragment,
  };
}

function buildTransportFromUriParams(params: URLSearchParams): NodeTransportConfig | undefined {
  const rawNet = (params.get('type') || params.get('net') || params.get('network') || '').trim().toLowerCase();
  const path = parseNonEmptyString(params.get('path'));
  const host = parseNonEmptyString(params.get('host'));

  if (rawNet === 'ws' || rawNet === 'websocket') {
    const ws: Extract<NodeTransportConfig, { type: 'ws' }> = { type: 'ws' };
    if (path) ws.path = path;
    if (host) ws.headers = { Host: host };
    const ed = parseNonNegativeInt(params.get('ed') ?? params.get('max-early-data'));
    if (ed !== null && ed > 0) ws.maxEarlyData = ed;
    return ws;
  }

  if (rawNet === 'grpc') {
    const serviceName = parseNonEmptyString(params.get('serviceName') || params.get('service-name') || path);
    return {
      type: 'grpc',
      ...(serviceName ? { serviceName } : {}),
    };
  }

  if (rawNet === 'http' || rawNet === 'h2') {
    const hosts = host
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      type: 'http',
      ...(hosts && hosts.length > 0 ? { host: hosts } : {}),
      ...(path ? { path } : {}),
    };
  }

  if (rawNet === 'httpupgrade') {
    return {
      type: 'httpupgrade',
      ...(host ? { host } : {}),
      ...(path ? { path } : {}),
    };
  }

  if ((rawNet === 'tcp' || rawNet === 'raw') && (params.get('headerType') || '').toLowerCase() === 'http') {
    const hosts = host
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      type: 'http',
      ...(hosts && hosts.length > 0 ? { host: hosts } : {}),
      ...(path ? { path } : {}),
    };
  }

  return undefined;
}

function buildTransportFromClash(raw: Record<string, unknown>): NodeTransportConfig | undefined {
  const network = typeof raw.network === 'string' ? raw.network.trim().toLowerCase() : '';
  if (!network || network === 'tcp') return undefined;

  if (network === 'ws') {
    const opts = (raw['ws-opts'] ?? raw.wsOpts) as Record<string, unknown> | undefined;
    const ws: Extract<NodeTransportConfig, { type: 'ws' }> = { type: 'ws' };
    if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
      const path = parseNonEmptyString(opts.path);
      if (path) ws.path = path;
      const headers = parseStringRecord(opts.headers);
      if (headers) ws.headers = headers;
      const maxEarlyData = parseNonNegativeInt(opts['max-early-data'] ?? opts.maxEarlyData);
      if (maxEarlyData !== null && maxEarlyData > 0) ws.maxEarlyData = maxEarlyData;
      const earlyHeader = parseNonEmptyString(opts['early-data-header-name'] ?? opts.earlyDataHeaderName);
      if (earlyHeader) ws.earlyDataHeaderName = earlyHeader;
    }
    return ws;
  }

  if (network === 'grpc') {
    const opts = (raw['grpc-opts'] ?? raw.grpcOpts) as Record<string, unknown> | undefined;
    const serviceName =
      opts && typeof opts === 'object' && !Array.isArray(opts)
        ? parseNonEmptyString(opts['grpc-service-name'] ?? opts.serviceName)
        : null;
    return {
      type: 'grpc',
      ...(serviceName ? { serviceName } : {}),
    };
  }

  if (network === 'h2' || network === 'http') {
    const opts = (raw['h2-opts'] ?? raw['http-opts'] ?? raw.h2Opts ?? raw.httpOpts) as
      Record<string, unknown> | undefined;
    const httpTransport: Extract<NodeTransportConfig, { type: 'http' }> = { type: 'http' };
    if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
      if (Array.isArray(opts.host)) {
        const hosts = opts.host
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
        if (hosts.length > 0) httpTransport.host = hosts;
      } else if (typeof opts.host === 'string' && opts.host.trim()) {
        httpTransport.host = [opts.host.trim()];
      }
      if (Array.isArray(opts.path)) {
        const firstPath = opts.path.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
        if (firstPath) httpTransport.path = firstPath.trim();
      } else {
        const path = parseNonEmptyString(opts.path);
        if (path) httpTransport.path = path;
      }
      const method = parseNonEmptyString(opts.method);
      if (method) httpTransport.method = method;
      const headers = parseStringRecord(opts.headers);
      if (headers) httpTransport.headers = headers;
    }
    return httpTransport;
  }

  if (network === 'httpupgrade') {
    const opts = (raw['ws-opts'] ?? raw['httpupgrade-opts']) as Record<string, unknown> | undefined;
    const path = opts && typeof opts === 'object' && !Array.isArray(opts) ? parseNonEmptyString(opts.path) : null;
    const headers =
      opts && typeof opts === 'object' && !Array.isArray(opts) ? parseStringRecord(opts.headers) : undefined;
    const host = headers?.Host ?? headers?.host;
    return {
      type: 'httpupgrade',
      ...(host ? { host } : {}),
      ...(path ? { path } : {}),
      ...(headers ? { headers } : {}),
    };
  }

  return undefined;
}

type SingleParseOutcome =
  | { ok: true; node: ParsedNode }
  | { ok: false; reason: 'unsupported_protocol' | 'malformed'; protocol?: string; name?: string; message: string };

function parseSsPluginParam(rawPlugin: string): {
  plugin: string;
  pluginOpts?: Record<string, string | boolean | number>;
} | null {
  const parts = rawPlugin
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const plugin = parts[0];
  const opts: Record<string, string | boolean | number> = {};
  let hasOpts = false;
  for (let i = 1; i < parts.length; i += 1) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx === -1) {
      opts[parts[i]] = true;
      hasOpts = true;
    } else {
      const key = parts[i].slice(0, eqIdx).trim();
      const val = parts[i].slice(eqIdx + 1).trim();
      if (key) {
        opts[key] = val;
        hasOpts = true;
      }
    }
  }
  return hasOpts ? { plugin, pluginOpts: opts } : { plugin };
}

function parseSsUri(uri: string, schemeLen: number): SingleParseOutcome {
  let rest = uri.slice(schemeLen + 3);
  let fragment: string | null = null;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    fragment = sanitizeNodeName(safeDecodeUriComponent(rest.slice(hashIdx + 1)));
    rest = rest.slice(0, hashIdx);
  }

  let queryStr = '';
  const queryIdx = rest.indexOf('?');
  if (queryIdx !== -1) {
    queryStr = rest.slice(queryIdx + 1);
    rest = rest.slice(0, queryIdx);
  }
  const params = new URLSearchParams(queryStr);

  // Strip optional trailing slash before query/fragment
  const slashIdx = rest.indexOf('/');
  const mainPart = slashIdx === -1 ? rest : rest.slice(0, slashIdx);

  let cipher: string;
  let password: string;
  let hostPort: { server: string; port: number } | null;

  const atIdx = mainPart.lastIndexOf('@');
  if (atIdx !== -1) {
    // SIP002: base64(method:password)@host:port OR percent-encoded method:password@host:port
    const rawUserinfo = mainPart.slice(0, atIdx);
    hostPort = parseHostPort(mainPart.slice(atIdx + 1));
    const decodedUserinfo = safeDecodeUriComponent(rawUserinfo);
    if (decodedUserinfo.includes(':')) {
      const colonIdx = decodedUserinfo.indexOf(':');
      cipher = decodedUserinfo.slice(0, colonIdx).trim();
      password = decodedUserinfo.slice(colonIdx + 1);
    } else {
      const b64 = decodeBase64Utf8(rawUserinfo);
      if (!b64 || !b64.includes(':')) {
        return {
          ok: false,
          reason: 'malformed',
          protocol: 'ss',
          name: fragment ?? undefined,
          message: 'SS 节点认证信息无效。',
        };
      }
      const colonIdx = b64.indexOf(':');
      cipher = b64.slice(0, colonIdx).trim();
      password = b64.slice(colonIdx + 1);
    }
  } else {
    // Legacy: base64(method:password@host:port)
    const decoded = decodeBase64Utf8(mainPart);
    if (!decoded) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'ss',
        name: fragment ?? undefined,
        message: 'SS 节点 Base64 解码失败。',
      };
    }
    const decodedAtIdx = decoded.lastIndexOf('@');
    if (decodedAtIdx === -1) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'ss',
        name: fragment ?? undefined,
        message: 'SS 节点缺少服务器地址。',
      };
    }
    const creds = decoded.slice(0, decodedAtIdx);
    const colonIdx = creds.indexOf(':');
    if (colonIdx === -1) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'ss',
        name: fragment ?? undefined,
        message: 'SS 节点缺少加密方式或密码。',
      };
    }
    cipher = creds.slice(0, colonIdx).trim();
    password = creds.slice(colonIdx + 1);
    hostPort = parseHostPort(decoded.slice(decodedAtIdx + 1));
  }

  if (!hostPort || !cipher || !password) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'ss',
      name: fragment ?? undefined,
      message: 'SS 节点字段不完整或端口无效。',
    };
  }

  const node: ShadowsocksNode = {
    name: fragment ?? `${hostPort.server}:${hostPort.port}`,
    type: 'ss',
    server: hostPort.server,
    port: hostPort.port,
    cipher,
    password,
  };

  const pluginRaw = params.get('plugin');
  if (pluginRaw) {
    const parsedPlugin = parseSsPluginParam(pluginRaw);
    if (parsedPlugin) {
      node.plugin = parsedPlugin.plugin;
      if (parsedPlugin.pluginOpts) node.pluginOpts = parsedPlugin.pluginOpts;
    }
  }
  const udp = parseBooleanFlag(params.get('udp'));
  if (udp !== undefined) node.udp = udp;
  const tfo = parseBooleanFlag(params.get('tfo'));
  if (tfo !== undefined) node.tfo = tfo;

  return { ok: true, node };
}

function parseVmessUri(uri: string): SingleParseOutcome {
  let payload = uri.slice('vmess://'.length).trim();
  let fragment: string | null = null;
  const hashIdx = payload.indexOf('#');
  if (hashIdx !== -1) {
    fragment = sanitizeNodeName(safeDecodeUriComponent(payload.slice(hashIdx + 1)));
    payload = payload.slice(0, hashIdx).trim();
  }

  // Standard V2RayN JSON format: vmess://<base64(json)>
  const decoded = decodeBase64Utf8(payload);
  if (decoded && decoded.trim().startsWith('{')) {
    let raw: unknown;
    try {
      raw = JSON.parse(decoded);
    } catch {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'vmess',
        name: fragment ?? undefined,
        message: 'VMess 节点 JSON 解析失败。',
      };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'vmess',
        name: fragment ?? undefined,
        message: 'VMess 节点格式无效。',
      };
    }
    const obj = raw as Record<string, unknown>;
    const name = sanitizeNodeName(obj.ps) ?? fragment;
    const server = parseServer(obj.add);
    const port = parsePort(obj.port);
    const uuid = parseUuid(obj.id);
    const alterId = obj.aid === undefined || obj.aid === '' ? 0 : parseNonNegativeInt(obj.aid);
    if (!server || port === null || !uuid || alterId === null) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'vmess',
        name: name ?? undefined,
        message: 'VMess 节点缺少必需字段或 UUID/端口无效。',
      };
    }

    const security = parseNonEmptyString(obj.scy) ?? parseNonEmptyString(obj.security) ?? 'auto';
    const node: VmessNode = {
      name: name ?? `${server}:${port}`,
      type: 'vmess',
      server,
      port,
      uuid,
      alterId,
      security,
    };

    const tlsRaw = typeof obj.tls === 'string' ? obj.tls.trim().toLowerCase() : obj.tls;
    if (tlsRaw === 'tls' || tlsRaw === true || tlsRaw === '1') {
      const serverName = parseNonEmptyString(obj.sni) ?? parseNonEmptyString(obj.host) ?? undefined;
      const alpn = parseAlpnList(obj.alpn);
      const fingerprint = parseNonEmptyString(obj.fp) ?? undefined;
      const insecure = parseBooleanFlag(obj.allowInsecure ?? obj['skip-cert-verify']);
      node.tls = {
        enabled: true,
        ...(serverName ? { serverName } : {}),
        ...(insecure !== undefined ? { insecure } : {}),
        ...(alpn ? { alpn } : {}),
        ...(fingerprint ? { fingerprint } : {}),
      };
    }

    const net = typeof obj.net === 'string' ? obj.net.trim().toLowerCase() : '';
    const path = parseNonEmptyString(obj.path) ?? undefined;
    const host = parseNonEmptyString(obj.host) ?? undefined;
    if (net === 'ws') {
      node.transport = {
        type: 'ws',
        ...(path ? { path } : {}),
        ...(host ? { headers: { Host: host } } : {}),
      };
    } else if (net === 'grpc') {
      node.transport = {
        type: 'grpc',
        ...(path ? { serviceName: path } : {}),
      };
    } else if (net === 'h2' || net === 'http' || (net === 'tcp' && String(obj.type ?? '').toLowerCase() === 'http')) {
      const hosts = host
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      node.transport = {
        type: 'http',
        ...(hosts && hosts.length > 0 ? { host: hosts } : {}),
        ...(path ? { path } : {}),
      };
    } else if (net === 'httpupgrade') {
      node.transport = {
        type: 'httpupgrade',
        ...(host ? { host } : {}),
        ...(path ? { path } : {}),
      };
    }

    return { ok: true, node };
  }

  // Fallback: URL-style vmess://[cipher:]uuid@host:port?params#name
  const parts = splitProxyUri(uri, 'vmess'.length);
  if (!parts) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'vmess',
      name: fragment ?? undefined,
      message: 'VMess 节点链接格式无效。',
    };
  }
  const userinfo = safeDecodeUriComponent(parts.userinfo);
  let security = parseNonEmptyString(parts.params.get('encryption') || parts.params.get('scy')) ?? 'auto';
  let uuidCandidate = userinfo;
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx !== -1) {
    security = userinfo.slice(0, colonIdx).trim() || security;
    uuidCandidate = userinfo.slice(colonIdx + 1);
  }
  const uuid = parseUuid(uuidCandidate);
  const aidRaw = parts.params.get('aid') ?? parts.params.get('alterId');
  const alterId = aidRaw === null || aidRaw === '' ? 0 : parseNonNegativeInt(aidRaw);
  if (!uuid || alterId === null) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'vmess',
      name: parts.fragment ?? undefined,
      message: 'VMess 节点 UUID 或 alterId 无效。',
    };
  }

  const node: VmessNode = {
    name: parts.fragment ?? `${parts.server}:${parts.port}`,
    type: 'vmess',
    server: parts.server,
    port: parts.port,
    uuid,
    alterId,
    security,
  };
  const secParam = (parts.params.get('security') || parts.params.get('tls') || '').trim().toLowerCase();
  if (secParam === 'tls' || secParam === '1' || secParam === 'true') {
    const serverName = parseNonEmptyString(parts.params.get('sni') || parts.params.get('peer')) ?? undefined;
    const insecure = parseBooleanFlag(parts.params.get('allowInsecure') ?? parts.params.get('insecure'));
    const alpn = parseAlpnList(parts.params.get('alpn'));
    const fingerprint = parseNonEmptyString(parts.params.get('fp')) ?? undefined;
    node.tls = {
      enabled: true,
      ...(serverName ? { serverName } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    };
  }
  const transport = buildTransportFromUriParams(parts.params);
  if (transport) node.transport = transport;
  return { ok: true, node };
}

function parseVlessUri(uri: string): SingleParseOutcome {
  const parts = splitProxyUri(uri, 'vless'.length);
  if (!parts) {
    return { ok: false, reason: 'malformed', protocol: 'vless', message: 'VLESS 节点链接格式无效。' };
  }

  const uuid = parseUuid(safeDecodeUriComponent(parts.userinfo));
  if (!uuid) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'vless',
      name: parts.fragment ?? undefined,
      message: 'VLESS 节点 UUID 无效。',
    };
  }

  const security = (parts.params.get('security') || '').trim().toLowerCase();
  const sni = parseNonEmptyString(parts.params.get('sni') || parts.params.get('peer')) ?? undefined;
  const fingerprint = parseNonEmptyString(parts.params.get('fp') || parts.params.get('fingerprint')) ?? undefined;
  const insecure = parseBooleanFlag(parts.params.get('allowInsecure') ?? parts.params.get('insecure'));
  const alpn = parseAlpnList(parts.params.get('alpn'));

  let tls: NodeTlsConfig | undefined;
  if (security === 'reality') {
    const publicKey = parseNonEmptyString(parts.params.get('pbk'));
    if (!publicKey) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'vless',
        name: parts.fragment ?? undefined,
        message: 'VLESS Reality 节点缺少公钥 pbk。',
      };
    }
    const shortId = parseNonEmptyString(parts.params.get('sid')) ?? undefined;
    tls = {
      enabled: true,
      ...(sni ? { serverName: sni } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      reality: {
        publicKey,
        ...(shortId ? { shortId } : {}),
      },
    };
  } else if (security === 'tls' || security === 'xtls') {
    tls = {
      enabled: true,
      ...(sni ? { serverName: sni } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    };
  } else if (security && security !== 'none') {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'vless',
      name: parts.fragment ?? undefined,
      message: 'VLESS 节点 security 参数无效。',
    };
  }

  const flow = parseNonEmptyString(parts.params.get('flow')) ?? undefined;
  const encryption = parseNonEmptyString(parts.params.get('encryption')) ?? 'none';
  const packetEncoding =
    parseNonEmptyString(parts.params.get('packetEncoding') || parts.params.get('packet-encoding')) ?? undefined;
  const transport = buildTransportFromUriParams(parts.params);

  const node: VlessNode = {
    name: parts.fragment ?? `${parts.server}:${parts.port}`,
    type: 'vless',
    server: parts.server,
    port: parts.port,
    uuid,
    ...(flow ? { flow } : {}),
    encryption,
    ...(tls ? { tls } : {}),
    ...(transport ? { transport } : {}),
    ...(packetEncoding ? { packetEncoding } : {}),
  };

  return { ok: true, node };
}

function parseTrojanUri(uri: string): SingleParseOutcome {
  const parts = splitProxyUri(uri, 'trojan'.length);
  if (!parts) {
    return { ok: false, reason: 'malformed', protocol: 'trojan', message: 'Trojan 节点链接格式无效。' };
  }

  const password = parseNonEmptyString(safeDecodeUriComponent(parts.userinfo));
  if (!password) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'trojan',
      name: parts.fragment ?? undefined,
      message: 'Trojan 节点缺少密码。',
    };
  }

  const security = (parts.params.get('security') || 'tls').trim().toLowerCase();
  const sni = parseNonEmptyString(parts.params.get('sni') || parts.params.get('peer')) ?? undefined;
  const fingerprint = parseNonEmptyString(parts.params.get('fp') || parts.params.get('fingerprint')) ?? undefined;
  const insecure = parseBooleanFlag(parts.params.get('allowInsecure') ?? parts.params.get('insecure'));
  const alpn = parseAlpnList(parts.params.get('alpn'));

  let tls: NodeTlsConfig | undefined;
  if (security === 'reality') {
    const publicKey = parseNonEmptyString(parts.params.get('pbk'));
    if (!publicKey) {
      return {
        ok: false,
        reason: 'malformed',
        protocol: 'trojan',
        name: parts.fragment ?? undefined,
        message: 'Trojan Reality 节点缺少公钥 pbk。',
      };
    }
    const shortId = parseNonEmptyString(parts.params.get('sid')) ?? undefined;
    tls = {
      enabled: true,
      ...(sni ? { serverName: sni } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      reality: {
        publicKey,
        ...(shortId ? { shortId } : {}),
      },
    };
  } else if (security !== 'none') {
    tls = {
      enabled: true,
      ...(sni ? { serverName: sni } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    };
  }

  const transport = buildTransportFromUriParams(parts.params);
  const node: TrojanNode = {
    name: parts.fragment ?? `${parts.server}:${parts.port}`,
    type: 'trojan',
    server: parts.server,
    port: parts.port,
    password,
    ...(tls ? { tls } : {}),
    ...(transport ? { transport } : {}),
  };

  return { ok: true, node };
}

function parseHysteria2Uri(uri: string, schemeLen: number): SingleParseOutcome {
  const parts = splitProxyUri(uri, schemeLen);
  if (!parts) {
    return { ok: false, reason: 'malformed', protocol: 'hysteria2', message: 'Hysteria2 节点链接格式无效。' };
  }

  const password = parseNonEmptyString(safeDecodeUriComponent(parts.userinfo));
  if (!password) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'hysteria2',
      name: parts.fragment ?? undefined,
      message: 'Hysteria2 节点缺少认证密码。',
    };
  }

  const sni = parseNonEmptyString(parts.params.get('sni') || parts.params.get('peer')) ?? undefined;
  const insecure = parseBooleanFlag(parts.params.get('insecure') ?? parts.params.get('allowInsecure'));
  const alpn = parseAlpnList(parts.params.get('alpn'));
  const obfsType = parseNonEmptyString(parts.params.get('obfs'));
  const obfsPassword = parseNonEmptyString(parts.params.get('obfs-password')) ?? undefined;
  const upMbps = parseMbps(parts.params.get('up') ?? parts.params.get('upmbps'));
  const downMbps = parseMbps(parts.params.get('down') ?? parts.params.get('downmbps'));
  const ports = parseNonEmptyString(parts.params.get('mport')) ?? undefined;

  const node: Hysteria2Node = {
    name: parts.fragment ?? `${parts.server}:${parts.port}`,
    type: 'hysteria2',
    server: parts.server,
    port: parts.port,
    password,
    ...(obfsType ? { obfs: { type: obfsType, ...(obfsPassword ? { password: obfsPassword } : {}) } } : {}),
    ...(upMbps !== undefined ? { upMbps } : {}),
    ...(downMbps !== undefined ? { downMbps } : {}),
    ...(ports ? { ports } : {}),
    tls: {
      enabled: true,
      ...(sni ? { serverName: sni } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
    },
  };

  return { ok: true, node };
}

function parseTuicUri(uri: string): SingleParseOutcome {
  const parts = splitProxyUri(uri, 'tuic'.length);
  if (!parts) {
    return { ok: false, reason: 'malformed', protocol: 'tuic', message: 'TUIC 节点链接格式无效。' };
  }

  const colonIdx = parts.userinfo.indexOf(':');
  if (colonIdx === -1) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'tuic',
      name: parts.fragment ?? undefined,
      message: 'TUIC 节点缺少密码。',
    };
  }
  const uuid = parseUuid(safeDecodeUriComponent(parts.userinfo.slice(0, colonIdx)));
  const password = parseNonEmptyString(safeDecodeUriComponent(parts.userinfo.slice(colonIdx + 1)));
  if (!uuid || !password) {
    return {
      ok: false,
      reason: 'malformed',
      protocol: 'tuic',
      name: parts.fragment ?? undefined,
      message: 'TUIC 节点 UUID 或密码无效。',
    };
  }

  const sni = parseNonEmptyString(parts.params.get('sni') || parts.params.get('peer')) ?? undefined;
  const insecure = parseBooleanFlag(
    parts.params.get('allow_insecure') ?? parts.params.get('insecure') ?? parts.params.get('allowInsecure'),
  );
  const alpn = parseAlpnList(parts.params.get('alpn'));
  const congestionControl =
    parseNonEmptyString(parts.params.get('congestion_control') || parts.params.get('congestion-control')) ?? undefined;
  const udpRelayMode =
    parseNonEmptyString(parts.params.get('udp_relay_mode') || parts.params.get('udp-relay-mode')) ?? undefined;
  const zeroRttHandshake = parseBooleanFlag(
    parts.params.get('reduce_rtt') ?? parts.params.get('reduce-rtt') ?? parts.params.get('zero_rtt_handshake'),
  );
  const disableSni = parseBooleanFlag(parts.params.get('disable_sni') ?? parts.params.get('disable-sni'));

  const node: TuicNode = {
    name: parts.fragment ?? `${parts.server}:${parts.port}`,
    type: 'tuic',
    server: parts.server,
    port: parts.port,
    uuid,
    password,
    ...(congestionControl ? { congestionControl } : {}),
    ...(udpRelayMode ? { udpRelayMode } : {}),
    ...(zeroRttHandshake !== undefined ? { zeroRttHandshake } : {}),
    ...(disableSni !== undefined ? { disableSni } : {}),
    tls: {
      enabled: true,
      ...(sni ? { serverName: sni } : {}),
      ...(insecure !== undefined ? { insecure } : {}),
      ...(alpn ? { alpn } : {}),
    },
  };

  return { ok: true, node };
}

function parseSingleUri(uri: string): SingleParseOutcome {
  const match = uri.match(SCHEME_LINE_PATTERN);
  if (!match) {
    return { ok: false, reason: 'malformed', message: '节点条目不是有效的代理 URI。' };
  }

  const rawScheme = match[1];
  const protocol = normalizeProtocol(rawScheme);
  if (!protocol) {
    const label = sanitizeProtocolLabel(rawScheme);
    return {
      ok: false,
      reason: 'unsupported_protocol',
      protocol: label,
      message: `不支持的节点协议: ${label}`,
    };
  }

  switch (protocol) {
    case 'ss':
      return parseSsUri(uri, rawScheme.length);
    case 'vmess':
      return parseVmessUri(uri);
    case 'vless':
      return parseVlessUri(uri);
    case 'trojan':
      return parseTrojanUri(uri);
    case 'hysteria2':
      return parseHysteria2Uri(uri, rawScheme.length);
    case 'tuic':
      return parseTuicUri(uri);
  }
}

function parseClashRealityOpts(
  raw: Record<string, unknown>,
):
  | { present: false }
  | { present: true; valid: true; publicKey: string; shortId?: string }
  | { present: true; valid: false } {
  const realityRaw = raw['reality-opts'] ?? raw.realityOpts;
  if (realityRaw === undefined || realityRaw === null) {
    return { present: false };
  }
  if (typeof realityRaw !== 'object' || Array.isArray(realityRaw)) {
    return { present: true, valid: false };
  }
  const obj = realityRaw as Record<string, unknown>;
  const publicKey = parseNonEmptyString(obj['public-key'] ?? obj.publicKey);
  if (!publicKey) {
    return { present: true, valid: false };
  }
  const shortId = parseNonEmptyString(obj['short-id'] ?? obj.shortId) ?? undefined;
  return { present: true, valid: true, publicKey, shortId };
}

function buildClashTls(raw: Record<string, unknown>, defaultEnabled: boolean): NodeTlsConfig | undefined | 'invalid' {
  const reality = parseClashRealityOpts(raw);
  if (reality.present && !reality.valid) return 'invalid';

  const explicitTls = parseBooleanFlag(raw.tls);
  const enabled = reality.present ? true : (explicitTls ?? defaultEnabled);
  if (!enabled) return undefined;

  const serverName = parseNonEmptyString(raw.servername ?? raw.sni) ?? undefined;
  const insecure = parseBooleanFlag(raw['skip-cert-verify'] ?? raw.skipCertVerify ?? raw.insecure);
  const alpn = parseAlpnList(raw.alpn);
  const fingerprint =
    parseNonEmptyString(raw['client-fingerprint'] ?? raw.clientFingerprint ?? raw.fingerprint) ?? undefined;

  return {
    enabled: true,
    ...(serverName ? { serverName } : {}),
    ...(insecure !== undefined ? { insecure } : {}),
    ...(alpn ? { alpn } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    ...(reality.present
      ? {
          reality: {
            publicKey: reality.publicKey,
            ...(reality.shortId ? { shortId: reality.shortId } : {}),
          },
        }
      : {}),
  };
}

function parseClashProxyItem(item: unknown): SingleParseOutcome {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, reason: 'malformed', message: 'Clash 节点条目不是有效对象。' };
  }
  const raw = item as Record<string, unknown>;
  const name = sanitizeNodeName(raw.name);
  const rawType = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (!rawType) {
    return { ok: false, reason: 'malformed', name: name ?? undefined, message: 'Clash 节点缺少协议类型。' };
  }

  const protocol = normalizeProtocol(rawType);
  if (!protocol) {
    const label = sanitizeProtocolLabel(rawType);
    return {
      ok: false,
      reason: 'unsupported_protocol',
      protocol: label,
      name: name ?? undefined,
      message: `不支持的节点协议: ${label}`,
    };
  }

  const server = parseServer(raw.server);
  const port = parsePort(raw.port);
  if (!name || !server || port === null) {
    return {
      ok: false,
      reason: 'malformed',
      protocol,
      name: name ?? undefined,
      message: `${protocol.toUpperCase()} 节点缺少名称、服务器或有效端口。`,
    };
  }

  const udp = parseBooleanFlag(raw.udp);
  const tfo = parseBooleanFlag(raw.tfo);
  const base: Omit<ParsedNodeBase, 'type'> = {
    name,
    server,
    port,
    ...(udp !== undefined ? { udp } : {}),
    ...(tfo !== undefined ? { tfo } : {}),
  };

  switch (protocol) {
    case 'ss': {
      const cipher = parseNonEmptyString(raw.cipher);
      const password = parseNonEmptyString(raw.password);
      if (!cipher || !password) {
        return { ok: false, reason: 'malformed', protocol: 'ss', name, message: 'SS 节点缺少加密方式或密码。' };
      }
      const plugin = parseNonEmptyString(raw.plugin) ?? undefined;
      const rawPluginOpts = raw['plugin-opts'] ?? raw.pluginOpts;
      let pluginOpts: Record<string, string | boolean | number> | undefined;
      if (rawPluginOpts && typeof rawPluginOpts === 'object' && !Array.isArray(rawPluginOpts)) {
        const cleanOpts: Record<string, string | boolean | number> = {};
        for (const [k, v] of Object.entries(rawPluginOpts as Record<string, unknown>)) {
          if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') {
            cleanOpts[k] = v;
          }
        }
        if (Object.keys(cleanOpts).length > 0) pluginOpts = cleanOpts;
      }
      return {
        ok: true,
        node: {
          ...base,
          type: 'ss',
          cipher,
          password,
          ...(plugin ? { plugin } : {}),
          ...(pluginOpts ? { pluginOpts } : {}),
        },
      };
    }

    case 'vmess': {
      const uuid = parseUuid(raw.uuid);
      const alterId = raw.alterId === undefined ? 0 : parseNonNegativeInt(raw.alterId);
      if (!uuid || alterId === null) {
        return {
          ok: false,
          reason: 'malformed',
          protocol: 'vmess',
          name,
          message: 'VMess 节点 UUID 或 alterId 无效。',
        };
      }
      const tls = buildClashTls(raw, false);
      if (tls === 'invalid') {
        return { ok: false, reason: 'malformed', protocol: 'vmess', name, message: 'VMess 节点 TLS 配置无效。' };
      }
      const security = parseNonEmptyString(raw.cipher) ?? 'auto';
      const transport = buildTransportFromClash(raw);
      const packetEncoding = parseNonEmptyString(raw['packet-encoding'] ?? raw.packetEncoding) ?? undefined;
      return {
        ok: true,
        node: {
          ...base,
          type: 'vmess',
          uuid,
          alterId,
          security,
          ...(tls ? { tls } : {}),
          ...(transport ? { transport } : {}),
          ...(packetEncoding ? { packetEncoding } : {}),
        },
      };
    }

    case 'vless': {
      const uuid = parseUuid(raw.uuid);
      if (!uuid) {
        return { ok: false, reason: 'malformed', protocol: 'vless', name, message: 'VLESS 节点 UUID 无效。' };
      }
      const tls = buildClashTls(raw, false);
      if (tls === 'invalid') {
        return { ok: false, reason: 'malformed', protocol: 'vless', name, message: 'VLESS Reality 节点缺少公钥。' };
      }
      const flow = parseNonEmptyString(raw.flow) ?? undefined;
      const encryption = parseNonEmptyString(raw.encryption) ?? 'none';
      const transport = buildTransportFromClash(raw);
      const packetEncoding = parseNonEmptyString(raw['packet-encoding'] ?? raw.packetEncoding) ?? undefined;
      return {
        ok: true,
        node: {
          ...base,
          type: 'vless',
          uuid,
          ...(flow ? { flow } : {}),
          encryption,
          ...(tls ? { tls } : {}),
          ...(transport ? { transport } : {}),
          ...(packetEncoding ? { packetEncoding } : {}),
        },
      };
    }

    case 'trojan': {
      const password = parseNonEmptyString(raw.password);
      if (!password) {
        return { ok: false, reason: 'malformed', protocol: 'trojan', name, message: 'Trojan 节点缺少密码。' };
      }
      const tls = buildClashTls(raw, true);
      if (tls === 'invalid') {
        return { ok: false, reason: 'malformed', protocol: 'trojan', name, message: 'Trojan Reality 节点缺少公钥。' };
      }
      const transport = buildTransportFromClash(raw);
      return {
        ok: true,
        node: {
          ...base,
          type: 'trojan',
          password,
          ...(tls ? { tls } : {}),
          ...(transport ? { transport } : {}),
        },
      };
    }

    case 'hysteria2': {
      const password = parseNonEmptyString(raw.password ?? raw.auth);
      if (!password) {
        return { ok: false, reason: 'malformed', protocol: 'hysteria2', name, message: 'Hysteria2 节点缺少密码。' };
      }
      const tls = buildClashTls(raw, true);
      if (tls === 'invalid') {
        return {
          ok: false,
          reason: 'malformed',
          protocol: 'hysteria2',
          name,
          message: 'Hysteria2 节点 TLS 配置无效。',
        };
      }
      const obfsType = parseNonEmptyString(raw.obfs);
      const obfsPassword = parseNonEmptyString(raw['obfs-password'] ?? raw.obfsPassword) ?? undefined;
      const upMbps = parseMbps(raw.up);
      const downMbps = parseMbps(raw.down);
      const ports = parseNonEmptyString(raw.ports) ?? undefined;
      return {
        ok: true,
        node: {
          ...base,
          type: 'hysteria2',
          password,
          ...(obfsType ? { obfs: { type: obfsType, ...(obfsPassword ? { password: obfsPassword } : {}) } } : {}),
          ...(upMbps !== undefined ? { upMbps } : {}),
          ...(downMbps !== undefined ? { downMbps } : {}),
          ...(ports ? { ports } : {}),
          ...(tls ? { tls } : {}),
        },
      };
    }

    case 'tuic': {
      const uuid = parseUuid(raw.uuid);
      const password = parseNonEmptyString(raw.password);
      if (!uuid || !password) {
        return { ok: false, reason: 'malformed', protocol: 'tuic', name, message: 'TUIC 节点 UUID 或密码无效。' };
      }
      const tls = buildClashTls(raw, true);
      if (tls === 'invalid') {
        return { ok: false, reason: 'malformed', protocol: 'tuic', name, message: 'TUIC 节点 TLS 配置无效。' };
      }
      const congestionControl =
        parseNonEmptyString(raw['congestion-controller'] ?? raw['congestion-control'] ?? raw.congestionControl) ??
        undefined;
      const udpRelayMode = parseNonEmptyString(raw['udp-relay-mode'] ?? raw.udpRelayMode) ?? undefined;
      const zeroRttHandshake = parseBooleanFlag(
        raw['reduce-rtt'] ?? raw.reduceRtt ?? raw['zero-rtt-handshake'] ?? raw.zeroRttHandshake,
      );
      const disableSni = parseBooleanFlag(raw['disable-sni'] ?? raw.disableSni);
      return {
        ok: true,
        node: {
          ...base,
          type: 'tuic',
          uuid,
          password,
          ...(congestionControl ? { congestionControl } : {}),
          ...(udpRelayMode ? { udpRelayMode } : {}),
          ...(zeroRttHandshake !== undefined ? { zeroRttHandshake } : {}),
          ...(disableSni !== undefined ? { disableSni } : {}),
          ...(tls ? { tls } : {}),
        },
      };
    }
  }
}

function createEmptyReport(format: SubscriptionFormat): NodeParseReport {
  return {
    format,
    totalEntries: 0,
    parsedCount: 0,
    skippedCount: 0,
    truncated: false,
    truncatedCount: 0,
    protocolCounts: {},
    unsupportedProtocols: {},
    malformedCount: 0,
    skipped: [],
  };
}

function recordOutcome(nodes: ParsedNode[], report: NodeParseReport, index: number, outcome: SingleParseOutcome): void {
  if (outcome.ok) {
    nodes.push(outcome.node);
    report.parsedCount += 1;
    report.protocolCounts[outcome.node.type] = (report.protocolCounts[outcome.node.type] ?? 0) + 1;
    return;
  }

  report.skippedCount += 1;
  if (outcome.reason === 'unsupported_protocol') {
    const proto = outcome.protocol ?? 'unknown';
    report.unsupportedProtocols[proto] = (report.unsupportedProtocols[proto] ?? 0) + 1;
  } else {
    report.malformedCount += 1;
  }

  if (report.skipped.length < MAX_REPORT_SKIPPED_DETAILS) {
    report.skipped.push({
      index,
      reason: outcome.reason,
      ...(outcome.protocol ? { protocol: outcome.protocol } : {}),
      ...(outcome.name ? { name: outcome.name } : {}),
      message: outcome.message,
    });
  }
}

function recordTruncation(report: NodeParseReport, limit: number, extraCount: number): void {
  if (extraCount <= 0) return;
  report.truncated = true;
  report.truncatedCount += extraCount;
  report.skippedCount += extraCount;
  if (report.skipped.length < MAX_REPORT_SKIPPED_DETAILS) {
    report.skipped.push({
      index: limit,
      reason: 'limit_exceeded',
      message: `订阅条目超过上限（最多解析 ${limit} 条），已跳过其余 ${extraCount} 条。`,
    });
  }
}

function tryParseClashYamlProxies(text: string): { matched: true; proxies: unknown[] } | { matched: false } {
  if (!/^\s*proxies\s*:/m.test(text)) {
    return { matched: false };
  }
  try {
    const parsed = parseYaml(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.proxies)) {
        return { matched: true, proxies: obj.proxies };
      }
      if (obj.proxies === null || obj.proxies === undefined) {
        return { matched: true, proxies: [] };
      }
    }
  } catch {
    return { matched: false };
  }
  return { matched: false };
}

function parseClashProxiesArray(proxies: unknown[], maxEntries: number): ParseSubscriptionResult {
  const nodes: ParsedNode[] = [];
  const report = createEmptyReport('clash-yaml');
  report.totalEntries = proxies.length;

  const limit = Math.min(proxies.length, maxEntries);
  for (let i = 0; i < limit; i += 1) {
    recordOutcome(nodes, report, i, parseClashProxyItem(proxies[i]));
  }
  if (proxies.length > maxEntries) {
    recordTruncation(report, maxEntries, proxies.length - maxEntries);
  }
  return { nodes, report };
}

function expandUriLines(rawText: string): { lines: string[]; sawPlainUri: boolean; sawBase64Line: boolean } {
  const lines: string[] = [];
  let sawPlainUri = false;
  let sawBase64Line = false;

  for (const rawLine of rawText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    if (SCHEME_LINE_PATTERN.test(trimmed)) {
      sawPlainUri = true;
      lines.push(trimmed);
      continue;
    }

    // Support mixed files where individual lines are base64-encoded URI blocks
    const decodedLine = decodeBase64Utf8(trimmed);
    if (decodedLine && SCHEME_LINE_PATTERN.test(decodedLine.trim())) {
      sawBase64Line = true;
      for (const inner of decodedLine.split(/\r?\n/)) {
        const innerTrimmed = inner.trim();
        if (!innerTrimmed || innerTrimmed.startsWith('#') || innerTrimmed.startsWith('//')) continue;
        lines.push(innerTrimmed);
      }
      continue;
    }

    lines.push(trimmed);
  }

  return { lines, sawPlainUri, sawBase64Line };
}

function parseUriLines(lines: string[], format: SubscriptionFormat, maxEntries: number): ParseSubscriptionResult {
  const nodes: ParsedNode[] = [];
  const report = createEmptyReport(format);
  report.totalEntries = lines.length;

  const limit = Math.min(lines.length, maxEntries);
  for (let i = 0; i < limit; i += 1) {
    recordOutcome(nodes, report, i, parseSingleUri(lines[i]));
  }
  if (lines.length > maxEntries) {
    recordTruncation(report, maxEntries, lines.length - maxEntries);
  }
  return { nodes, report };
}

/**
 * Pure parser for B-class node subscriptions (design §11.3).
 *
 * Supports:
 * - Clash / mihomo YAML (`proxies: [...]`), plain or Base64-encoded
 * - Base64-encoded or plain-text proxy URI lists (including mixed plain + Base64 lines)
 * - Protocols: Shadowsocks (`ss`), VMess, VLESS (including Reality), Trojan, Hysteria2, TUIC
 *
 * Unsupported protocols and malformed entries are skipped and recorded in `report`
 * without ever including raw credentials or URLs. Oversized subscriptions are
 * truncated at `maxEntries` (default 1000).
 */
export function parseNodeSubscription(
  rawText: string,
  options: ParseSubscriptionOptions = {},
): ParseSubscriptionResult {
  const maxEntries =
    options.maxEntries !== undefined && Number.isInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_SUBSCRIPTION_ENTRIES;

  const stripped = rawText.replace(/^\uFEFF/, '').trim();
  if (!stripped) {
    return { nodes: [], report: createEmptyReport('empty') };
  }

  // 1. Direct Clash / mihomo YAML
  const directYaml = tryParseClashYamlProxies(stripped);
  if (directYaml.matched) {
    return parseClashProxiesArray(directYaml.proxies, maxEntries);
  }

  // 2. Whole-payload Base64 (decoding to either Clash YAML or a URI list)
  const hasTopLevelScheme = SCHEME_LINE_PATTERN.test(stripped);
  if (!hasTopLevelScheme) {
    const decodedWhole = decodeBase64Utf8(stripped);
    if (decodedWhole) {
      const decodedTrimmed = decodedWhole.replace(/^\uFEFF/, '').trim();
      if (!decodedTrimmed) {
        return { nodes: [], report: createEmptyReport('empty') };
      }

      const decodedYaml = tryParseClashYamlProxies(decodedTrimmed);
      if (decodedYaml.matched) {
        return parseClashProxiesArray(decodedYaml.proxies, maxEntries);
      }

      const expandedDecoded = expandUriLines(decodedTrimmed);
      if (expandedDecoded.sawPlainUri || expandedDecoded.sawBase64Line) {
        return parseUriLines(expandedDecoded.lines, 'base64-uri', maxEntries);
      }
    }
  }

  // 3. Plain-text URI list or mixed format (plain URIs + Base64 URI blocks + invalid lines)
  const expanded = expandUriLines(stripped);
  if (expanded.lines.length === 0) {
    return { nodes: [], report: createEmptyReport('empty') };
  }

  const format: SubscriptionFormat =
    expanded.sawPlainUri && expanded.sawBase64Line
      ? 'mixed'
      : expanded.sawPlainUri
        ? 'uri-list'
        : expanded.sawBase64Line
          ? 'base64-uri'
          : 'unknown';

  return parseUriLines(expanded.lines, format, maxEntries);
}

/**
 * Projects a parsed node down to safe preview metadata (name, protocol, detected
 * regions, info-banner flag). Strips server, port, password, UUID, and all keys.
 */
export function toNodePreview(node: ParsedNode): NodePreviewItem {
  const isInfo = isInfoNode(node.name);
  return {
    name: node.name,
    protocol: node.type,
    regions: isInfo ? [] : detectNodeRegions(node.name),
    isInfo,
  };
}

/** Groups safe preview items by ISO region code for empty-group inspection. */
export function groupPreviewNodesByRegion(items: readonly NodePreviewItem[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const item of items) {
    if (item.isInfo) continue;
    for (const region of item.regions) {
      if (!grouped[region]) grouped[region] = [];
      grouped[region].push(item.name);
    }
  }
  return grouped;
}
