import type { OutputProfile } from '../../../shared/clients';
import type { Condition, InlineRule, PolicyRef } from '../../../shared/schemas/card';
import type { DnsProfile, NodePool, NodeSlot, TemplateBody } from '../../../shared/schemas/template';
import { filterNodes, matchNodeFilter } from '../../nodes/filter';
import type {
  Hysteria2Node,
  NodeTlsConfig,
  NodeTransportConfig,
  ParsedNode,
  ShadowsocksNode,
  TrojanNode,
  TuicNode,
  VlessNode,
  VmessNode,
} from '../../nodes/parse';
import { detectRegexDialectIssues } from '../../nodes/regex';
import { CLIENT_CAPABILITIES, isRuleTypeSupported } from '../capabilities';
import { DEFAULT_HEALTH_CHECK, resolveTemplateCards, type ResolvedTemplateCard } from '../model';
import { applyEnhancementModules } from '../modules';
import { DNS_LEAK_FINAL_CARD_ID } from '../modules/dns-leak';
import { planRulesetReferences, type PlannedMatcherBinding, type PlannedProvider } from '../planner';
import { getNormalizedBodyPools } from '../pools';
import {
  evaluatePoolEmptyProtection,
  poolCompatibilityLocation,
  poolToNodeFilter,
  resolveStabilityPoolMembers,
} from './pool-helpers';
import type {
  CompatibilityItem,
  CompiledConfigResult,
  CompiledNodeSlotBinding,
  CompileTemplateInput,
  InlineProxyNode,
} from './types';

/**
 * Minimum target `sing-box` official version: **1.12** (see design §11.5 & §20).
 *
 * Uses sing-box 1.12 syntax throughout:
 * - Typed `dns.servers` (`https` / `tls` / `udp` / `tcp` / `quic` / `h3` / `local` / `dhcp` / `fakeip`),
 *   `domain_resolver` on domain-based DNS servers, and `route.default_domain_resolver`.
 * - `route.rule_set` (`remote` `.srs`/`.json` and `inline` headless rules) instead of removed
 *   `route.geoip` / `route.geosite` fields; native `ip_is_private` for `geoip: private`.
 * - Route rule actions (`sniff`, `hijack-dns`, `reject` / `method: "drop"`) instead of deprecated
 *   `block` and `dns` special outbounds.
 */
export const SINGBOX_MIN_VERSION = '1.12';

const SINGBOX_CAPS = CLIENT_CAPABILITIES['sing-box'];
const DIRECT_TAG = 'direct';
const BOOTSTRAP_DNS_TAG = 'dns-bootstrap';
const DIRECT_DNS_TAG = 'dns-direct';
const REMOTE_DNS_TAG = 'dns-remote';
const FAKEIP_DNS_TAG = 'dns-fakeip';

const DEFAULT_BOOTSTRAP_IP = '223.5.5.5';
const DEFAULT_DIRECT_DOH = 'https://dns.alidns.com/dns-query';
const DEFAULT_REMOTE_DOH = 'https://1.1.1.1/dns-query';
const DEFAULT_FAKEIP_INET4_RANGE = '198.18.0.0/15';
const DEFAULT_FAKEIP_INET6_RANGE = 'fc00::/18';

const METACUBEX_GEO_RE =
  /^https?:\/\/raw\.githubusercontent\.com\/MetaCubeX\/meta-rules-dat\/meta\/geo\/(geosite|geoip)\/([a-z0-9._!@+-]+)\.(?:list|ya?ml|mrs)$/i;

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

const IPV4_LITERAL_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV4_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const PORT_SINGLE_RE = /^\d{1,5}$/;
const PORT_RANGE_RE = /^(\d{1,5})\s*[-:]\s*(\d{1,5})$/;
const VALID_TUIC_CONGESTION = new Set(['cubic', 'new_reno', 'bbr']);
const VALID_TUIC_UDP_MODE = new Set(['native', 'quic']);
const VALID_PACKET_ENCODING = new Set(['packetaddr', 'xudp']);

type SingboxOutbound = Record<string, unknown> & {
  type: string;
  tag: string;
};

type SingboxRule = Record<string, unknown>;

type SingboxRuleSet =
  | {
      tag: string;
      type: 'remote';
      format: 'binary' | 'source';
      url: string;
      update_interval?: string;
    }
  | {
      tag: string;
      type: 'inline';
      rules: SingboxRule[];
    };

type ResolvedRuleTarget = { kind: 'outbound'; tag: string } | { kind: 'reject'; drop: boolean };

type InlinedNodeEntry = {
  slotId: string;
  originalName: string;
  tag: string;
  outbound: SingboxOutbound;
};

type SingboxNodeMapResult = {
  outbound: SingboxOutbound | null;
  warnings: CompatibilityItem[];
};

/**
 * Strips ASCII control characters and line separators from a string value.
 * Preserves quotes, backslashes, punctuation, and Unicode cleanly — JSON
 * serialization handles all JSON escaping safely.
 */
export function sanitizeSingboxScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes an outbound / group / node tag for sing-box JSON.
 * Quotes, backslashes, commas, and emoji are preserved safely in JSON strings.
 */
export function sanitizeSingboxTag(raw: string, fallback = 'Proxy'): string {
  const cleaned = sanitizeSingboxScalar(raw);
  return cleaned || fallback;
}

/**
 * Produces a safe, deterministic ASCII tag for `route.rule_set` entries.
 */
export function sanitizeSingboxRuleSetTag(raw: string, fallback = 'rule-set'): string {
  const normalized = sanitizeSingboxScalar(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

/**
 * Formats a duration in seconds using Go `time.Duration` units (`h`, `m`, `s`)
 * accepted universally by sing-box `interval` and `update_interval` fields.
 */
export function formatSingboxDuration(seconds: number): string {
  const safe = Math.max(1, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  let out = '';
  if (hours > 0) out += `${hours}h`;
  if (minutes > 0) out += `${minutes}m`;
  if (secs > 0 || !out) out += `${secs}s`;
  return out;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = sanitizeSingboxScalar(value);
  return /^https?:\/\/\S+$/i.test(trimmed);
}

function isIpLiteral(host: string): boolean {
  const trimmed = host.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) return false;
  if (IPV4_LITERAL_RE.test(trimmed)) {
    return trimmed.split('.').every((octet) => Number(octet) <= 255);
  }
  return trimmed.includes(':');
}

function normalizeIpv4Cidr(raw: string, fallback: string): string {
  const trimmed = sanitizeSingboxScalar(raw);
  const match = trimmed.match(IPV4_CIDR_RE);
  if (!match) return fallback;
  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  const prefix = Number(match[5]);
  if (octets.some((o) => o > 255) || prefix < 0 || prefix > 32) return fallback;
  const ipInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const a = (network >>> 24) & 0xff;
  const b = (network >>> 16) & 0xff;
  const c = (network >>> 8) & 0xff;
  const d = network & 0xff;
  return `${a}.${b}.${c}.${d}/${prefix}`;
}

function toSlotBindingMap(bindings?: CompileTemplateInput['slotBindings']): Map<string, CompiledNodeSlotBinding> {
  if (!bindings) return new Map();
  if (bindings instanceof Map) return new Map(bindings);
  return new Map(Object.entries(bindings));
}

function toInlinePayloadsMap(payloads?: CompileTemplateInput['inlineRulePayloads']): Map<string, readonly string[]> {
  if (!payloads) return new Map();
  if (payloads instanceof Map) return new Map(payloads);
  return new Map(Object.entries(payloads));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeObjects(merged[key] as Record<string, unknown>, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function dedupeStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers).sort()) {
    const cleanKey = sanitizeSingboxScalar(key);
    const cleanVal = sanitizeSingboxScalar(headers[key] ?? '');
    if (cleanKey && cleanVal) {
      out[cleanKey] = cleanVal;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildSingboxTls(
  tls: NodeTlsConfig | undefined,
  options: { required?: boolean; disableSni?: boolean } = {},
): Record<string, unknown> | undefined {
  const shouldEnable = options.required ? tls?.enabled !== false : Boolean(tls?.enabled);
  if (!shouldEnable) return undefined;

  const out: Record<string, unknown> = { enabled: true };
  if (options.disableSni) {
    out.disable_sni = true;
  } else if (tls?.serverName) {
    const sni = sanitizeSingboxScalar(tls.serverName);
    if (sni) out.server_name = sni;
  }

  if (tls?.insecure) {
    out.insecure = true;
  }

  if (tls?.alpn && tls.alpn.length > 0) {
    const alpn = dedupeStrings(tls.alpn.map(sanitizeSingboxScalar).filter(Boolean));
    if (alpn.length > 0) out.alpn = alpn;
  }

  const publicKey = tls?.reality?.publicKey ? sanitizeSingboxScalar(tls.reality.publicKey) : '';
  const fingerprint = tls?.fingerprint ? sanitizeSingboxScalar(tls.fingerprint) : '';

  if (fingerprint) {
    out.utls = { enabled: true, fingerprint };
  } else if (publicKey) {
    // sing-box requires uTLS to be enabled whenever Reality is configured.
    out.utls = { enabled: true, fingerprint: 'chrome' };
  }

  if (publicKey) {
    const reality: Record<string, unknown> = {
      enabled: true,
      public_key: publicKey,
    };
    const shortId = tls?.reality?.shortId ? sanitizeSingboxScalar(tls.reality.shortId) : '';
    if (shortId) reality.short_id = shortId;
    out.reality = reality;
  }

  return out;
}

function buildSingboxTransport(transport: NodeTransportConfig | undefined): Record<string, unknown> | undefined {
  if (!transport) return undefined;
  switch (transport.type) {
    case 'ws': {
      const out: Record<string, unknown> = { type: 'ws' };
      const path = transport.path ? sanitizeSingboxScalar(transport.path) : '';
      if (path) out.path = path;
      const headers = sanitizeHeaders(transport.headers);
      if (headers) out.headers = headers;
      if (transport.maxEarlyData && transport.maxEarlyData > 0) {
        out.max_early_data = Math.round(transport.maxEarlyData);
      }
      const edHeader = transport.earlyDataHeaderName ? sanitizeSingboxScalar(transport.earlyDataHeaderName) : '';
      if (edHeader) out.early_data_header_name = edHeader;
      return out;
    }
    case 'grpc': {
      const out: Record<string, unknown> = { type: 'grpc' };
      const serviceName = transport.serviceName ? sanitizeSingboxScalar(transport.serviceName) : '';
      if (serviceName) out.service_name = serviceName;
      return out;
    }
    case 'http': {
      const out: Record<string, unknown> = { type: 'http' };
      const hosts = transport.host ? dedupeStrings(transport.host.map(sanitizeSingboxScalar).filter(Boolean)) : [];
      if (hosts.length > 0) out.host = hosts;
      const path = transport.path ? sanitizeSingboxScalar(transport.path) : '';
      if (path) out.path = path;
      const method = transport.method ? sanitizeSingboxScalar(transport.method).toUpperCase() : '';
      if (method) out.method = method;
      const headers = sanitizeHeaders(transport.headers);
      if (headers) out.headers = headers;
      return out;
    }
    case 'httpupgrade': {
      const out: Record<string, unknown> = { type: 'httpupgrade' };
      const host = transport.host ? sanitizeSingboxScalar(transport.host) : '';
      if (host) out.host = host;
      const path = transport.path ? sanitizeSingboxScalar(transport.path) : '';
      if (path) out.path = path;
      const headers = sanitizeHeaders(transport.headers);
      if (headers) out.headers = headers;
      return out;
    }
  }
}

function serializeSsPluginOpts(
  plugin: 'obfs-local' | 'v2ray-plugin',
  opts?: Record<string, string | boolean | number>,
): string | undefined {
  if (!opts) return undefined;
  const pairs: string[] = [];
  for (const key of Object.keys(opts).sort()) {
    const val = opts[key];
    if (val === undefined || val === false) continue;

    let mappedKey = key;
    if (plugin === 'obfs-local') {
      if (key === 'mode') mappedKey = 'obfs';
      else if (key === 'host') mappedKey = 'obfs-host';
    }
    const cleanKey = sanitizeSingboxScalar(mappedKey);
    if (!cleanKey) continue;

    if (val === true) {
      pairs.push(cleanKey);
    } else {
      const cleanVal = sanitizeSingboxScalar(String(val));
      if (cleanVal) {
        pairs.push(`${cleanKey}=${cleanVal}`);
      }
    }
  }
  return pairs.length > 0 ? pairs.join(';') : undefined;
}

function normalizeHysteria2ServerPorts(rawPorts: string): string[] {
  const out: string[] = [];
  for (const segment of rawPorts.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(PORT_RANGE_RE);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start >= 1 && start <= 65535 && end >= start && end <= 65535) {
        out.push(`${start}:${end}`);
      }
      continue;
    }
    if (PORT_SINGLE_RE.test(trimmed)) {
      const port = Number(trimmed);
      if (port >= 1 && port <= 65535) {
        out.push(`${port}:${port}`);
      }
    }
  }
  return dedupeStrings(out);
}

function applyCommonDialFields(
  outbound: SingboxOutbound,
  node: ParsedNode,
  slotUdp: boolean | undefined,
  supportsTcpFastOpen: boolean,
): void {
  const effectiveUdp = node.udp !== undefined ? node.udp : slotUdp;
  if (effectiveUdp === false) {
    outbound.network = 'tcp';
  }
  if (supportsTcpFastOpen && node.tfo === true) {
    outbound.tcp_fast_open = true;
  }
}

/**
 * Maps a single M5.2a `ParsedNode` (6 supported protocols) to a sing-box 1.12
 * outbound JSON object, returning any per-node compatibility warnings.
 */
export function mapParsedNodeToSingboxOutbound(
  node: ParsedNode,
  tag: string,
  options: { slotId?: string; slotUdp?: boolean } = {},
): SingboxNodeMapResult {
  const warnings: CompatibilityItem[] = [];
  const server = sanitizeSingboxScalar(node.server);
  if (!server || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) {
    warnings.push({
      code: 'SKIPPED_UNSUPPORTED_NODES',
      severity: 'warning',
      message: `节点「${tag}」服务器地址或端口无效，已跳过。`,
      location: options.slotId ? { slotId: options.slotId } : undefined,
    });
    return { outbound: null, warnings };
  }

  switch (node.type) {
    case 'ss': {
      const ss = node as ShadowsocksNode;
      const outbound: SingboxOutbound = {
        type: 'shadowsocks',
        tag,
        server,
        server_port: ss.port,
        method: sanitizeSingboxScalar(ss.cipher),
        password: ss.password,
      };
      if (ss.plugin) {
        const lower = ss.plugin.trim().toLowerCase();
        if (lower === 'obfs' || lower === 'simple-obfs' || lower === 'obfs-local') {
          outbound.plugin = 'obfs-local';
          const pluginOpts = serializeSsPluginOpts('obfs-local', ss.pluginOpts);
          if (pluginOpts) outbound.plugin_opts = pluginOpts;
        } else if (lower === 'v2ray-plugin') {
          outbound.plugin = 'v2ray-plugin';
          const pluginOpts = serializeSsPluginOpts('v2ray-plugin', ss.pluginOpts);
          if (pluginOpts) outbound.plugin_opts = pluginOpts;
        } else {
          warnings.push({
            code: 'UNSUPPORTED_CLIENT_FEATURE',
            severity: 'warning',
            message: `sing-box 1.12 Shadowsocks 出站仅支持 obfs-local / v2ray-plugin，已忽略节点「${tag}」的插件 ${ss.plugin}。`,
            location: options.slotId ? { slotId: options.slotId } : undefined,
          });
        }
      }
      applyCommonDialFields(outbound, node, options.slotUdp, true);
      return { outbound, warnings };
    }

    case 'vmess': {
      const vmess = node as VmessNode;
      const outbound: SingboxOutbound = {
        type: 'vmess',
        tag,
        server,
        server_port: vmess.port,
        uuid: sanitizeSingboxScalar(vmess.uuid),
        security: sanitizeSingboxScalar(vmess.security || 'auto') || 'auto',
        alter_id: vmess.alterId,
      };
      if (vmess.packetEncoding) {
        const pe = vmess.packetEncoding.trim().toLowerCase();
        if (VALID_PACKET_ENCODING.has(pe)) {
          outbound.packet_encoding = pe;
        }
      }
      const tls = buildSingboxTls(vmess.tls);
      if (tls) outbound.tls = tls;
      const transport = buildSingboxTransport(vmess.transport);
      if (transport) outbound.transport = transport;
      applyCommonDialFields(outbound, node, options.slotUdp, true);
      return { outbound, warnings };
    }

    case 'vless': {
      const vless = node as VlessNode;
      const outbound: SingboxOutbound = {
        type: 'vless',
        tag,
        server,
        server_port: vless.port,
        uuid: sanitizeSingboxScalar(vless.uuid),
      };
      if (vless.flow) {
        const flow = sanitizeSingboxScalar(vless.flow);
        if (flow) outbound.flow = flow;
      }
      if (vless.encryption && vless.encryption.trim().toLowerCase() !== 'none') {
        warnings.push({
          code: 'UNSUPPORTED_CLIENT_FEATURE',
          severity: 'warning',
          message: `sing-box VLESS 不支持非 none 的 encryption（${vless.encryption}），已忽略节点「${tag}」的该字段。`,
          location: options.slotId ? { slotId: options.slotId } : undefined,
        });
      }
      if (vless.packetEncoding) {
        const pe = vless.packetEncoding.trim().toLowerCase();
        if (VALID_PACKET_ENCODING.has(pe)) {
          outbound.packet_encoding = pe;
        }
      }
      const tls = buildSingboxTls(vless.tls);
      if (tls) outbound.tls = tls;
      const transport = buildSingboxTransport(vless.transport);
      if (transport) outbound.transport = transport;
      applyCommonDialFields(outbound, node, options.slotUdp, true);
      return { outbound, warnings };
    }

    case 'trojan': {
      const trojan = node as TrojanNode;
      const outbound: SingboxOutbound = {
        type: 'trojan',
        tag,
        server,
        server_port: trojan.port,
        password: trojan.password,
      };
      const tls = buildSingboxTls(trojan.tls, { required: true });
      if (tls) outbound.tls = tls;
      const transport = buildSingboxTransport(trojan.transport);
      if (transport) outbound.transport = transport;
      applyCommonDialFields(outbound, node, options.slotUdp, true);
      return { outbound, warnings };
    }

    case 'hysteria2': {
      const hy2 = node as Hysteria2Node;
      const outbound: SingboxOutbound = {
        type: 'hysteria2',
        tag,
        server,
      };
      // In sing-box 1.12, `server_ports` and `server_port` are mutually exclusive.
      const serverPorts = hy2.ports ? normalizeHysteria2ServerPorts(hy2.ports) : [];
      if (serverPorts.length > 0) {
        outbound.server_ports = serverPorts;
      } else {
        outbound.server_port = hy2.port;
      }
      if (hy2.upMbps && hy2.upMbps > 0) {
        outbound.up_mbps = Math.round(hy2.upMbps);
      }
      if (hy2.downMbps && hy2.downMbps > 0) {
        outbound.down_mbps = Math.round(hy2.downMbps);
      }
      if (hy2.obfs?.type) {
        const obfsType = hy2.obfs.type.trim().toLowerCase();
        if (obfsType === 'salamander') {
          outbound.obfs = {
            type: 'salamander',
            ...(hy2.obfs.password ? { password: hy2.obfs.password } : {}),
          };
        } else {
          warnings.push({
            code: 'UNSUPPORTED_CLIENT_FEATURE',
            severity: 'warning',
            message: `sing-box 1.12 Hysteria2 仅支持 salamander 混淆，已忽略节点「${tag}」的混淆类型 ${hy2.obfs.type}。`,
            location: options.slotId ? { slotId: options.slotId } : undefined,
          });
        }
      }
      outbound.password = hy2.password;
      const tls = buildSingboxTls(hy2.tls, { required: true });
      if (tls) outbound.tls = tls;
      applyCommonDialFields(outbound, node, options.slotUdp, false);
      return { outbound, warnings };
    }

    case 'tuic': {
      const tuic = node as TuicNode;
      const outbound: SingboxOutbound = {
        type: 'tuic',
        tag,
        server,
        server_port: tuic.port,
        uuid: sanitizeSingboxScalar(tuic.uuid),
        password: tuic.password,
      };
      if (tuic.congestionControl) {
        const cc = tuic.congestionControl.trim().toLowerCase().replace(/-/g, '_');
        if (VALID_TUIC_CONGESTION.has(cc)) {
          outbound.congestion_control = cc;
        } else {
          warnings.push({
            code: 'UNSUPPORTED_CLIENT_FEATURE',
            severity: 'warning',
            message: `sing-box TUIC 不支持拥塞控制算法 ${tuic.congestionControl}，已忽略节点「${tag}」的该字段。`,
            location: options.slotId ? { slotId: options.slotId } : undefined,
          });
        }
      }
      if (tuic.udpRelayMode) {
        const mode = tuic.udpRelayMode.trim().toLowerCase();
        if (VALID_TUIC_UDP_MODE.has(mode)) {
          outbound.udp_relay_mode = mode;
        } else {
          warnings.push({
            code: 'UNSUPPORTED_CLIENT_FEATURE',
            severity: 'warning',
            message: `sing-box TUIC 不支持 udp_relay_mode=${tuic.udpRelayMode}，已忽略节点「${tag}」的该字段。`,
            location: options.slotId ? { slotId: options.slotId } : undefined,
          });
        }
      }
      if (tuic.zeroRttHandshake !== undefined) {
        outbound.zero_rtt_handshake = tuic.zeroRttHandshake;
      }
      const tls = buildSingboxTls(tuic.tls, { required: true, disableSni: tuic.disableSni });
      if (tls) outbound.tls = tls;
      applyCommonDialFields(outbound, node, options.slotUdp, false);
      return { outbound, warnings };
    }
  }
}

function coerceInlineProxyToParsedNode(raw: InlineProxyNode): ParsedNode | null {
  const type = String(raw.type ?? '')
    .trim()
    .toLowerCase();
  const server = typeof raw.server === 'string' ? raw.server.trim() : '';
  const port = typeof raw.port === 'number' ? raw.port : Number(raw.port);
  if (!server || !Number.isInteger(port) || port < 1 || port > 65535) return null;

  const base = {
    name: raw.name,
    server,
    port,
    ...(typeof raw.udp === 'boolean' ? { udp: raw.udp } : {}),
    ...(typeof raw.tfo === 'boolean' ? { tfo: raw.tfo } : {}),
  };

  if (type === 'ss' || type === 'shadowsocks') {
    const cipher = String(raw.cipher ?? raw.method ?? '').trim();
    const password = String(raw.password ?? '');
    if (!cipher) return null;
    return { ...base, type: 'ss', cipher, password };
  }
  if (type === 'vmess') {
    const uuid = String(raw.uuid ?? '').trim();
    if (!uuid) return null;
    return {
      ...base,
      type: 'vmess',
      uuid,
      alterId: Number(raw.alterId ?? raw.alter_id ?? 0) || 0,
      security: String(raw.security ?? raw.cipher ?? 'auto'),
    };
  }
  if (type === 'vless') {
    const uuid = String(raw.uuid ?? '').trim();
    if (!uuid) return null;
    return {
      ...base,
      type: 'vless',
      uuid,
      ...(typeof raw.flow === 'string' ? { flow: raw.flow } : {}),
    };
  }
  if (type === 'trojan') {
    const password = String(raw.password ?? '');
    if (!password) return null;
    return { ...base, type: 'trojan', password };
  }
  if (type === 'hysteria2' || type === 'hy2') {
    const password = String(raw.password ?? '');
    if (!password) return null;
    return { ...base, type: 'hysteria2', password };
  }
  if (type === 'tuic') {
    const uuid = String(raw.uuid ?? '').trim();
    const password = String(raw.password ?? '');
    if (!uuid) return null;
    return { ...base, type: 'tuic', uuid, password };
  }
  return null;
}

function parsePortListValue(raw: string): { ports: number[]; ranges: string[] } | null {
  const ports: number[] = [];
  const ranges: string[] = [];
  for (const part of raw.split('/')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = trimmed.match(PORT_RANGE_RE);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start >= 1 && start <= 65535 && end >= start && end <= 65535) {
        ranges.push(`${start}:${end}`);
        continue;
      }
      return null;
    }
    if (PORT_SINGLE_RE.test(trimmed)) {
      const port = Number(trimmed);
      if (port >= 1 && port <= 65535) {
        ports.push(port);
        continue;
      }
    }
    return null;
  }
  if (ports.length === 0 && ranges.length === 0) return null;
  return { ports: [...new Set(ports)], ranges: dedupeStrings(ranges) };
}

function addRuleEntryToHeadless(
  bucket: {
    domain: string[];
    domain_suffix: string[];
    domain_keyword: string[];
    domain_regex: string[];
    ip_cidr: string[];
    source_ip_cidr: string[];
    port: number[];
    port_range: string[];
    source_port: number[];
    source_port_range: string[];
    process_name: string[];
    network: string[];
  },
  type: string,
  value: string,
): boolean {
  const normalizedType = type.trim().toUpperCase();
  const cleanValue = sanitizeSingboxScalar(value);
  if (!cleanValue) return false;

  switch (normalizedType) {
    case 'DOMAIN':
      bucket.domain.push(cleanValue);
      return true;
    case 'DOMAIN-SUFFIX':
      bucket.domain_suffix.push(cleanValue.replace(/^\.+/, ''));
      return true;
    case 'DOMAIN-KEYWORD':
      bucket.domain_keyword.push(cleanValue);
      return true;
    case 'DOMAIN-REGEX':
      bucket.domain_regex.push(cleanValue);
      return true;
    case 'IP-CIDR':
    case 'IP-CIDR6':
      bucket.ip_cidr.push(cleanValue);
      return true;
    case 'SRC-IP-CIDR':
    case 'SRC-IP':
      bucket.source_ip_cidr.push(cleanValue);
      return true;
    case 'DST-PORT':
    case 'DEST-PORT': {
      const parsed = parsePortListValue(cleanValue);
      if (!parsed) return false;
      bucket.port.push(...parsed.ports);
      bucket.port_range.push(...parsed.ranges);
      return true;
    }
    case 'SRC-PORT': {
      const parsed = parsePortListValue(cleanValue);
      if (!parsed) return false;
      bucket.source_port.push(...parsed.ports);
      bucket.source_port_range.push(...parsed.ranges);
      return true;
    }
    case 'PROCESS-NAME':
      bucket.process_name.push(cleanValue);
      return true;
    case 'NETWORK':
      bucket.network.push(cleanValue.toLowerCase());
      return true;
    default:
      return false;
  }
}

function compileInlineRulePayloadToHeadlessRules(
  lines: readonly string[],
  behavior: PlannedProvider['behavior'],
): SingboxRule[] {
  const bucket = {
    domain: [] as string[],
    domain_suffix: [] as string[],
    domain_keyword: [] as string[],
    domain_regex: [] as string[],
    ip_cidr: [] as string[],
    source_ip_cidr: [] as string[],
    port: [] as number[],
    port_range: [] as string[],
    source_port: [] as number[],
    source_port_range: [] as string[],
    process_name: [] as string[],
    network: [] as string[],
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith(';')) continue;

    if (trimmed.includes(',')) {
      const [ruleType, ruleValue] = trimmed.split(',');
      if (ruleType && ruleValue) {
        addRuleEntryToHeadless(bucket, ruleType, ruleValue);
      }
      continue;
    }

    if (behavior === 'ipcidr') {
      bucket.ip_cidr.push(sanitizeSingboxScalar(trimmed));
      continue;
    }

    if (behavior === 'domain') {
      if (trimmed.startsWith('+.')) {
        bucket.domain_suffix.push(sanitizeSingboxScalar(trimmed.slice(2)));
      } else if (trimmed.startsWith('.')) {
        bucket.domain_suffix.push(sanitizeSingboxScalar(trimmed.slice(1)));
      } else {
        bucket.domain.push(sanitizeSingboxScalar(trimmed));
      }
      continue;
    }

    // Classical bare domain fallback
    bucket.domain_suffix.push(sanitizeSingboxScalar(trimmed.replace(/^\+?\./, '')));
  }

  const rule: SingboxRule = {};
  const addStr = (key: keyof typeof bucket) => {
    const unique = dedupeStrings(bucket[key] as string[]);
    if (unique.length > 0) rule[key] = unique;
  };
  const addNum = (key: 'port' | 'source_port') => {
    const unique = [...new Set(bucket[key])];
    if (unique.length > 0) rule[key] = unique;
  };

  addStr('domain');
  addStr('domain_suffix');
  addStr('domain_keyword');
  addStr('domain_regex');
  addStr('ip_cidr');
  addStr('source_ip_cidr');
  addNum('port');
  addStr('port_range');
  addNum('source_port');
  addStr('source_port_range');
  addStr('process_name');
  addStr('network');

  return Object.keys(rule).length > 0 ? [rule] : [];
}

function compileInlineRuleToCondition(
  rule: InlineRule,
  cardId: string,
  ensureGeoRuleSet: (kind: 'geosite' | 'geoip', name: string) => { nativePrivate?: boolean; tag?: string },
  items: CompatibilityItem[],
): SingboxRule | null {
  if (!isRuleTypeSupported('sing-box', rule.type)) {
    items.push({
      code: 'UNSUPPORTED_RULE_TYPE',
      severity: 'warning',
      message: `sing-box 1.12 不支持规则类型 ${rule.type}（${rule.value}），已跳过。`,
      location: { cardId },
    });
    return null;
  }

  const value = sanitizeSingboxScalar(rule.value);
  if (!value) return null;

  switch (rule.type) {
    case 'DOMAIN':
      return { domain: [value] };
    case 'DOMAIN-SUFFIX':
      return { domain_suffix: [value.replace(/^\.+/, '')] };
    case 'DOMAIN-KEYWORD':
      return { domain_keyword: [value] };
    case 'DOMAIN-REGEX':
      return { domain_regex: [value] };
    case 'IP-CIDR':
      return { ip_cidr: [value] };
    case 'SRC-IP-CIDR':
      return { source_ip_cidr: [value] };
    case 'DST-PORT': {
      const parsed = parsePortListValue(value);
      if (!parsed) return null;
      const out: SingboxRule = {};
      if (parsed.ports.length > 0) out.port = parsed.ports;
      if (parsed.ranges.length > 0) out.port_range = parsed.ranges;
      return out;
    }
    case 'SRC-PORT': {
      const parsed = parsePortListValue(value);
      if (!parsed) return null;
      const out: SingboxRule = {};
      if (parsed.ports.length > 0) out.source_port = parsed.ports;
      if (parsed.ranges.length > 0) out.source_port_range = parsed.ranges;
      return out;
    }
    case 'PROCESS-NAME':
      return { process_name: [value] };
    case 'NETWORK':
      return { network: [value.toLowerCase()] };
    case 'GEOSITE': {
      const resolved = ensureGeoRuleSet('geosite', value.toLowerCase());
      return resolved.tag ? { rule_set: [resolved.tag] } : null;
    }
    case 'GEOIP': {
      const resolved = ensureGeoRuleSet('geoip', value.toLowerCase());
      if (resolved.nativePrivate) return { ip_is_private: true };
      return resolved.tag ? { rule_set: [resolved.tag] } : null;
    }
    default:
      return null;
  }
}

function compileConditionToSingboxRule(
  cond: Condition,
  cardId: string,
  ensureGeoRuleSet: (kind: 'geosite' | 'geoip', name: string) => { nativePrivate?: boolean; tag?: string },
  items: CompatibilityItem[],
): SingboxRule | null {
  if (cond.op === 'rule') {
    return compileInlineRuleToCondition(cond.rule, cardId, ensureGeoRuleSet, items);
  }

  if (cond.op === 'not') {
    const inner = compileConditionToSingboxRule(cond.item, cardId, ensureGeoRuleSet, items);
    if (!inner) return null;
    if (inner.invert === true) {
      const { invert: _removed, ...rest } = inner;
      return rest;
    }
    return { ...inner, invert: true };
  }

  const children = cond.items
    .map((child) => compileConditionToSingboxRule(child, cardId, ensureGeoRuleSet, items))
    .filter((child): child is SingboxRule => child !== null);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  return {
    type: 'logical',
    mode: cond.op === 'and' ? 'and' : 'or',
    rules: children,
  };
}

function attachRuleTarget(rule: SingboxRule, target: ResolvedRuleTarget): SingboxRule {
  if (target.kind === 'reject') {
    return target.drop ? { ...rule, action: 'reject', method: 'drop' } : { ...rule, action: 'reject' };
  }
  return { ...rule, outbound: target.tag };
}

function parseSingboxDnsServer(
  rawEntry: string,
  tag: string,
  bootstrapTag: string,
  options: { detour?: string; stripSystem?: boolean } = {},
): { server: Record<string, unknown> | null; skippedSystem?: boolean; unsupported?: boolean } {
  const trimmed = sanitizeSingboxScalar(rawEntry);
  if (!trimmed) return { server: null };
  const lower = trimmed.toLowerCase();

  if (lower === 'system' || lower === 'local') {
    if (options.stripSystem) return { server: null, skippedSystem: true };
    return { server: { type: 'local', tag } };
  }
  if (lower.startsWith('dhcp://')) {
    if (options.stripSystem) return { server: null, skippedSystem: true };
    return { server: { type: 'dhcp', tag } };
  }

  // Plain IP literal (optionally IPv4:port)
  if (!trimmed.includes('://')) {
    let host: string;
    let port: number | undefined;
    if (IPV4_LITERAL_RE.test(trimmed)) {
      host = trimmed;
    } else if (/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(trimmed)) {
      const idx = trimmed.lastIndexOf(':');
      host = trimmed.slice(0, idx);
      port = Number(trimmed.slice(idx + 1));
    } else if (trimmed.includes(':')) {
      host = trimmed.replace(/^\[|\]$/g, '');
    } else {
      return { server: null, unsupported: true };
    }
    const serverObj: Record<string, unknown> = {
      type: 'udp',
      tag,
      server: host,
    };
    if (port && port !== 53 && port >= 1 && port <= 65535) {
      serverObj.server_port = port;
    }
    if (options.detour) serverObj.detour = options.detour;
    return { server: serverObj };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { server: null, unsupported: true };
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { server: null, unsupported: true };
  const port = parsed.port ? Number(parsed.port) : undefined;
  const needsResolver = !isIpLiteral(host) && tag !== bootstrapTag;

  const base: Record<string, unknown> = {
    tag,
    server: host,
  };
  if (needsResolver) {
    base.domain_resolver = bootstrapTag;
  }
  if (options.detour) {
    base.detour = options.detour;
  }

  switch (scheme) {
    case 'udp':
      return {
        server: {
          type: 'udp',
          ...base,
          ...(port && port !== 53 ? { server_port: port } : {}),
        },
      };
    case 'tcp':
      return {
        server: {
          type: 'tcp',
          ...base,
          ...(port && port !== 53 ? { server_port: port } : {}),
        },
      };
    case 'tls':
      return {
        server: {
          type: 'tls',
          ...base,
          ...(port && port !== 853 ? { server_port: port } : {}),
        },
      };
    case 'https': {
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/dns-query';
      return {
        server: {
          type: 'https',
          ...base,
          ...(port && port !== 443 ? { server_port: port } : {}),
          ...(path !== '/dns-query' ? { path } : {}),
        },
      };
    }
    case 'quic':
      return {
        server: {
          type: 'quic',
          ...base,
          ...(port && port !== 853 ? { server_port: port } : {}),
        },
      };
    case 'h3': {
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/dns-query';
      return {
        server: {
          type: 'h3',
          ...base,
          ...(port && port !== 443 ? { server_port: port } : {}),
          ...(path !== '/dns-query' ? { path } : {}),
        },
      };
    }
    default:
      return { server: null, unsupported: true };
  }
}

function buildFakeIpBypassRule(filters: readonly string[] | undefined): SingboxRule | null {
  if (!filters || filters.length === 0) return null;
  const domains: string[] = [];
  const suffixes: string[] = [];
  for (const raw of filters) {
    const trimmed = sanitizeSingboxScalar(raw);
    if (!trimmed || trimmed.startsWith('geosite:')) continue;
    if (trimmed.startsWith('+.')) {
      suffixes.push(trimmed.slice(2));
    } else if (trimmed.startsWith('*.')) {
      suffixes.push(trimmed.slice(2));
    } else if (trimmed.startsWith('.')) {
      suffixes.push(trimmed.slice(1));
    } else if (!trimmed.includes('*') && !trimmed.includes('?')) {
      domains.push(trimmed);
    }
  }
  const uniqueDomains = dedupeStrings(domains);
  const uniqueSuffixes = dedupeStrings(suffixes);
  if (uniqueDomains.length === 0 && uniqueSuffixes.length === 0) return null;
  const rule: SingboxRule = {};
  if (uniqueDomains.length > 0) rule.domain = uniqueDomains;
  if (uniqueSuffixes.length > 0) rule.domain_suffix = uniqueSuffixes;
  return rule;
}

function buildSingboxDns(params: {
  dns: DnsProfile;
  ipv6: boolean;
  dnsLeakGuardActive: boolean;
  proxyDetourTag: string | null;
  emittedRuleSetTags: ReadonlySet<string>;
  items: CompatibilityItem[];
}): { dns: Record<string, unknown>; defaultDomainResolver: string; isFakeIp: boolean } {
  const { dns, ipv6, dnsLeakGuardActive, proxyDetourTag, emittedRuleSetTags, items } = params;
  const isFakeIp = (dns.mode ?? 'fake-ip') === 'fake-ip';

  // 1. Always create an IP-based bootstrap DNS server for domain_resolver / default_domain_resolver
  const bootstrapCandidates = [
    ...(Array.isArray(dns.custom?.proxyServerNameserver)
      ? (dns.custom?.proxyServerNameserver as unknown[]).map(String)
      : []),
    ...(dns.defaultNameserver ?? []),
  ];
  let bootstrapIp = DEFAULT_BOOTSTRAP_IP;
  for (const candidate of bootstrapCandidates) {
    const trimmed = sanitizeSingboxScalar(candidate);
    if (isIpLiteral(trimmed)) {
      bootstrapIp = trimmed.replace(/^\[|\]$/g, '');
      break;
    }
  }

  const servers: Record<string, unknown>[] = [
    {
      type: 'udp',
      tag: BOOTSTRAP_DNS_TAG,
      server: bootstrapIp,
    },
  ];

  // 2. Direct domestic DNS (used for domestic rule_sets and standard non-leak-guard queries)
  let hasDirectDns = false;
  if (!dnsLeakGuardActive) {
    const directCandidates = dns.nameserver && dns.nameserver.length > 0 ? dns.nameserver : [DEFAULT_DIRECT_DOH];
    for (const candidate of directCandidates) {
      const parsed = parseSingboxDnsServer(candidate, DIRECT_DNS_TAG, BOOTSTRAP_DNS_TAG, {
        stripSystem: false,
      });
      if (parsed.server) {
        servers.push(parsed.server);
        hasDirectDns = true;
        break;
      }
      if (parsed.unsupported) {
        items.push({
          code: 'UNSUPPORTED_DNS_OPTION',
          severity: 'warning',
          message: `sing-box 1.12 不支持 DNS 地址「${candidate}」，已跳过。`,
        });
      }
    }
    if (!hasDirectDns) {
      servers.push({
        type: 'https',
        tag: DIRECT_DNS_TAG,
        server: 'dns.alidns.com',
        domain_resolver: BOOTSTRAP_DNS_TAG,
      });
      hasDirectDns = true;
    }
  }

  // 3. Remote encrypted DNS (detours through proxy when a non-direct proxy group exists)
  const remoteCandidates =
    dns.fallback && dns.fallback.length > 0
      ? dns.fallback
      : dnsLeakGuardActive && dns.nameserver && dns.nameserver.length > 0
        ? dns.nameserver
        : [DEFAULT_REMOTE_DOH];

  let hasRemoteDns = false;
  for (const candidate of remoteCandidates) {
    const parsed = parseSingboxDnsServer(candidate, REMOTE_DNS_TAG, BOOTSTRAP_DNS_TAG, {
      detour: proxyDetourTag ?? undefined,
      stripSystem: dnsLeakGuardActive,
    });
    if (parsed.server) {
      servers.push(parsed.server);
      hasRemoteDns = true;
      break;
    }
    if (parsed.unsupported) {
      items.push({
        code: 'UNSUPPORTED_DNS_OPTION',
        severity: 'warning',
        message: `sing-box 1.12 不支持远程 DNS 地址「${candidate}」，已跳过。`,
      });
    }
  }
  if (!hasRemoteDns) {
    servers.push({
      type: 'https',
      tag: REMOTE_DNS_TAG,
      server: '1.1.1.1',
      ...(proxyDetourTag ? { detour: proxyDetourTag } : {}),
    });
    hasRemoteDns = true;
  }

  // 4. FakeIP server (sing-box 1.12 typed server syntax)
  if (isFakeIp) {
    const rawFakeIpRange =
      typeof dns.custom?.['fake-ip-range'] === 'string'
        ? dns.custom['fake-ip-range']
        : typeof dns.custom?.fakeIpRange === 'string'
          ? dns.custom.fakeIpRange
          : undefined;
    const inet4Range = rawFakeIpRange
      ? normalizeIpv4Cidr(rawFakeIpRange, DEFAULT_FAKEIP_INET4_RANGE)
      : DEFAULT_FAKEIP_INET4_RANGE;
    servers.push({
      type: 'fakeip',
      tag: FAKEIP_DNS_TAG,
      inet4_range: inet4Range,
      ...(ipv6 ? { inet6_range: DEFAULT_FAKEIP_INET6_RANGE } : {}),
    });
  }

  // 5. DNS routing rules (only reference rule_set tags actually present in route.rule_set)
  const rules: SingboxRule[] = [];
  const domesticDnsTag = hasDirectDns ? DIRECT_DNS_TAG : BOOTSTRAP_DNS_TAG;

  const domesticRuleSets: string[] = [];
  if (emittedRuleSetTags.has('geosite-private')) domesticRuleSets.push('geosite-private');
  if (emittedRuleSetTags.has('geosite-cn')) domesticRuleSets.push('geosite-cn');

  if (domesticRuleSets.length > 0) {
    rules.push({
      rule_set: domesticRuleSets,
      server: domesticDnsTag,
    });
  }

  if (isFakeIp) {
    const bypassRule = buildFakeIpBypassRule(dns.fakeIpFilter);
    if (bypassRule) {
      rules.push({ ...bypassRule, server: domesticDnsTag });
    }
    rules.push({
      query_type: ipv6 ? ['A', 'AAAA'] : ['A'],
      server: FAKEIP_DNS_TAG,
    });
  }

  const dnsDoc: Record<string, unknown> = {
    servers,
    rules,
    final: dnsLeakGuardActive ? REMOTE_DNS_TAG : hasRemoteDns ? REMOTE_DNS_TAG : domesticDnsTag,
    ...(ipv6 === false ? { strategy: 'ipv4_only' } : {}),
  };

  if (dnsLeakGuardActive) {
    items.push({
      code: 'MODULE_NOTE',
      severity: 'info',
      message: proxyDetourTag
        ? `防 DNS 泄漏已按 sing-box ${SINGBOX_MIN_VERSION} 新版 DNS 语法输出：已移除本地/系统 DNS，默认经「${proxyDetourTag}」走加密上游 ${REMOTE_DNS_TAG}，并以 ${BOOTSTRAP_DNS_TAG} 作为 route.default_domain_resolver。`
        : `防 DNS 泄漏已按 sing-box ${SINGBOX_MIN_VERSION} 新版 DNS 语法输出（当前无可用代理节点组，未附加代理 detour）。`,
      location: { moduleId: 'dns-leak-guard' },
    });
  }

  return {
    dns: dnsDoc,
    defaultDomainResolver: BOOTSTRAP_DNS_TAG,
    isFakeIp,
  };
}

/**
 * Pure sing-box 1.12 compiler (design §10.6, §10.11–§10.13, §11 B-class).
 *
 * - Inlines M5.2a parsed node snapshots into `outbounds` (6 protocols, Reality,
 *   uTLS, transports, SIP003 plugins, Hysteria2 port ranges, TUIC options).
 * - Filters nodes server-side using JS regex (`src/domain/nodes/filter.ts`) to
 *   build `selector` and `urltest` outbound groups.
 * - Emits `route.rule_set` (`remote` `.srs`/`.json` and `inline` headless rules)
 *   and 1.12 route rule actions (`sniff`, `hijack-dns`, `reject`).
 * - Outputs sing-box 1.12 typed DNS syntax (including `dns-leak-guard`).
 * - Deterministic JSON output with zero side effects or I/O.
 */
export function compileSingbox(input: CompileTemplateInput): CompiledConfigResult {
  const output: OutputProfile = input.output ?? input.body.output;
  const items: CompatibilityItem[] = [];
  const slotBindings = toSlotBindingMap(input.slotBindings);
  const inlinePayloads = toInlinePayloadsMap(input.inlineRulePayloads);

  // 1. Resolve template cards and apply enabled enhancement modules
  const rawResolved = resolveTemplateCards(input.body, input.cards);
  for (const missingCardId of rawResolved.missingCardIds) {
    items.push({
      code: 'MISSING_CARD_REFERENCE',
      severity: 'warning',
      message: `模板引用了不存在的应用组件 ${missingCardId}，已忽略。`,
      location: { cardId: missingCardId },
    });
  }

  let resolved = rawResolved;
  let appliedModules: string[] = [];
  let skippedModules: string[] = [];

  if (input.applyModules !== false) {
    const modResult = applyEnhancementModules(rawResolved, {
      client: 'sing-box',
      registry: input.moduleRegistry,
    });
    resolved = modResult.template;
    appliedModules = modResult.applied;
    skippedModules = modResult.skipped.map((s) => s.moduleId);
    for (const skip of modResult.skipped) {
      items.push({
        code: 'MODULE_SKIPPED',
        severity: 'info',
        message: skip.message,
        location: { moduleId: skip.moduleId },
      });
    }
    for (const note of modResult.notes) {
      items.push({
        code: 'MODULE_NOTE',
        severity: 'info',
        message: note,
      });
    }
  }

  const body: TemplateBody = resolved.body;
  const multiSlot = body.slots.length > 1;
  const perProviderMode = multiSlot && (body.combineMode ?? body.wizardMeta?.combineMode) === 'perProvider';
  const dnsLeakGuardActive = Boolean(body.dns.custom?.dnsLeakGuard || appliedModules.includes('dns-leak-guard'));
  const activeCards = resolved.cards.filter((c) => c.enabled);

  // 2. Plan deduplicated rule-set references
  const rulesetPlan = planRulesetReferences({
    cards: activeCards,
    client: 'sing-box',
    catalogIndex: input.catalogIndex,
    rulesetBehaviors: input.rulesetBehaviors,
    baseUrl: input.baseUrl,
  });
  for (const w of rulesetPlan.warnings) {
    items.push({
      code: w.code === 'CATALOG_ENTRY_MISSING' ? 'CATALOG_ENTRY_MISSING' : 'GEOSITE_CONVERTED_TO_SELF_HOSTED',
      severity: w.code === 'CATALOG_ENTRY_MISSING' ? 'warning' : 'info',
      message: w.message,
      location: { cardId: w.cardId },
    });
  }

  // 3. Allocate unique outbound tags (groups first so node tags never steal a group name)
  const usedOutboundTags = new Set<string>([DIRECT_TAG, 'block', 'dns-out']);
  const allocateOutboundTag = (raw: string, fallback: string, location?: CompatibilityItem['location']): string => {
    const base = sanitizeSingboxTag(raw, fallback);
    if (!usedOutboundTags.has(base)) {
      usedOutboundTags.add(base);
      return base;
    }
    let idx = 2;
    while (usedOutboundTags.has(`${base} (${idx})`)) {
      idx += 1;
    }
    const unique = `${base} (${idx})`;
    usedOutboundTags.add(unique);
    if (location) {
      items.push({
        code: 'GROUP_NAME_SANITIZED',
        severity: 'info',
        message: `出站标签「${raw}」发生冲突，已调整为「${unique}」。`,
        location,
      });
    }
    return unique;
  };

  const hasExplicitPools = body.pools !== undefined;
  const bodyPools = getNormalizedBodyPools(body);

  // Detect cards whose primary policy is REJECT / REJECT-DROP (compiled directly as route action: reject)
  const cardRejectTarget = new Map<string, { kind: 'reject'; drop: boolean }>();
  const cardTagById = new Map<string, string>();
  const poolTagById = new Map<string, string>();

  for (const pool of bodyPools) {
    const tag = allocateOutboundTag(
      pool.name,
      pool.kind === 'region' ? `Region-${pool.id}` : `Pool-${pool.id}`,
      poolCompatibilityLocation(pool, hasExplicitPools),
    );
    poolTagById.set(pool.id, tag);
  }

  for (const card of activeCards) {
    const first = card.effective.group.candidates[0];
    if (first && first.kind === 'builtin' && (first.id === 'REJECT' || first.id === 'REJECT-DROP')) {
      const drop = first.id === 'REJECT-DROP';
      cardRejectTarget.set(card.cardId, { kind: 'reject', drop });
      const hasNonRejectAlternative = card.effective.group.candidates.some(
        (c) => !(c.kind === 'builtin' && (c.id === 'REJECT' || c.id === 'REJECT-DROP')),
      );
      if (hasNonRejectAlternative) {
        items.push({
          code: 'UNSUPPORTED_CLIENT_FEATURE',
          severity: 'info',
          message: `sing-box ${SINGBOX_MIN_VERSION} 已弃用 block 出站，组件「${card.effective.name}」的匹配规则已直接编译为 route action: reject${drop ? ' (method: drop)' : ''}。`,
          location: { cardId: card.cardId },
        });
      }
      continue;
    }
    const tag = allocateOutboundTag(card.effective.name, `Group-${card.cardId}`, { cardId: card.cardId });
    cardTagById.set(card.cardId, tag);
  }

  const airportTagBySlotId = new Map<string, string>();
  let allNodesTag: string | null = null;
  if (perProviderMode) {
    for (const slot of body.slots) {
      const slotTag = allocateOutboundTag(slot.name, `Provider-${slot.id}`, { slotId: slot.id });
      airportTagBySlotId.set(slot.id, slotTag);
    }
    allNodesTag = allocateOutboundTag('🌐 全部节点', 'All-Nodes');
  }

  // 4. Inline parsed nodes from B-class slot snapshots (filtering by slot.excludeInfo & slot.filter)
  const slotNodesById = new Map<string, InlinedNodeEntry[]>();
  const allInlinedNodes: InlinedNodeEntry[] = [];
  const slotById = new Map<string, NodeSlot>(body.slots.map((s) => [s.id, s]));

  for (const slot of body.slots) {
    const binding = slotBindings.get(slot.id);
    const slotEntries: InlinedNodeEntry[] = [];
    slotNodesById.set(slot.id, slotEntries);

    if (!binding) {
      items.push({
        code: 'UNBOUND_NODE_SLOT',
        severity: 'info',
        message: `节点槽位「${slot.name}」(${slot.id}) 未绑定节点快照，相关地区组与策略组在无节点时将回退。`,
        location: { slotId: slot.id },
      });
      continue;
    }

    if (binding.kind === 'http' || binding.kind === 'file') {
      items.push({
        code: 'UNSUPPORTED_PROVIDER_OPTION',
        severity: 'warning',
        message: `sing-box ${SINGBOX_MIN_VERSION} 不支持远程/本地节点订阅引用（槽位 ${slot.name}），需使用服务端解析后的节点快照内联。`,
        location: { slotId: slot.id },
      });
      continue;
    }

    let rawNodes: readonly ParsedNode[] = [];
    if (binding.kind === 'snapshot') {
      rawNodes = binding.nodes;
      if (binding.stale) {
        items.push({
          code: 'STALE_NODE_SNAPSHOT',
          severity: 'warning',
          message: `节点槽位「${slot.name}」使用了过期快照（上次成功拉取：${binding.fetchedAt ?? '未知'}${binding.staleReason ? `；原因：${binding.staleReason}` : ''}）。`,
          location: { slotId: slot.id },
        });
      }
      if (binding.report && binding.report.skippedCount > 0) {
        const protoSummary = Object.entries(binding.report.unsupportedProtocols)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([proto, count]) => `${proto}×${count}`)
          .join(', ');
        items.push({
          code: 'SKIPPED_UNSUPPORTED_NODES',
          severity: 'warning',
          message: `节点槽位「${slot.name}」跳过了 ${binding.report.skippedCount} 个不支持或格式错误的节点${protoSummary ? `（不支持协议：${protoSummary}）` : ''}。`,
          location: { slotId: slot.id },
        });
      }
    } else if (binding.kind === 'inline') {
      const coerced: ParsedNode[] = [];
      let skippedInline = 0;
      for (const proxy of binding.proxies) {
        const parsed = coerceInlineProxyToParsedNode(proxy);
        if (parsed) coerced.push(parsed);
        else skippedInline += 1;
      }
      if (skippedInline > 0) {
        items.push({
          code: 'SKIPPED_UNSUPPORTED_NODES',
          severity: 'warning',
          message: `节点槽位「${slot.name}」跳过了 ${skippedInline} 个 sing-box 不支持的内联节点。`,
          location: { slotId: slot.id },
        });
      }
      rawNodes = coerced;
    }

    const filteredNodes = filterNodes(rawNodes, undefined, {
      excludeInfo: slot.excludeInfo !== false,
    });
    const slotPrefix = multiSlot ? sanitizeSingboxTag(slot.name, slot.id) : '';

    for (const node of filteredNodes) {
      const candidateName =
        multiSlot && !node.name.startsWith(`${slotPrefix} · `) ? `${slotPrefix} · ${node.name}` : node.name;
      const tag = allocateOutboundTag(candidateName, 'Node');
      const mapped = mapParsedNodeToSingboxOutbound(node, tag, {
        slotId: slot.id,
        slotUdp: slot.udp,
      });
      items.push(...mapped.warnings);
      if (mapped.outbound) {
        const entry: InlinedNodeEntry = {
          slotId: slot.id,
          originalName: node.name,
          tag,
          outbound: mapped.outbound,
        };
        slotEntries.push(entry);
        allInlinedNodes.push(entry);
      }
    }
  }

  // 5. Build NodePool outbounds (server-side JS regex filtering)
  const poolOutboundById = new Map<string, SingboxOutbound>();
  const poolHasRealNodes = new Map<string, boolean>();
  const allInlinedNodeTags = allInlinedNodes.map((n) => n.tag);

  // Pass 1: all non-stability node pools
  for (const pool of bodyPools) {
    if (pool.kind === 'stability') continue;
    const tag = poolTagById.get(pool.id)!;
    const location = poolCompatibilityLocation(pool, hasExplicitPools);
    const singleSourceSlotId = Array.isArray(pool.sources) && pool.sources.length === 1 ? pool.sources[0] : undefined;
    const targetSlots =
      pool.kind === 'region' &&
      multiSlot &&
      (pool.sources === 'all' ||
        singleSourceSlotId === 'slot-main' ||
        (singleSourceSlotId !== undefined && !slotById.has(singleSourceSlotId)))
        ? body.slots.map((s) => s.id)
        : pool.sources === 'all'
          ? body.slots.map((s) => s.id)
          : pool.sources;
    const nodeFilter = poolToNodeFilter(pool);

    for (const pattern of [pool.include, pool.exclude]) {
      if (!pattern) continue;
      for (const issue of detectRegexDialectIssues(pattern, 'sing-box')) {
        items.push({
          code: 'REGEX_DIALECT_WARNING',
          severity: 'warning',
          message: `${pool.kind === 'region' ? '地区组' : '节点池'}「${pool.name}」的过滤正则：${issue.message}`,
          location,
        });
      }
    }

    const emptyProtection = evaluatePoolEmptyProtection({
      pool,
      client: 'sing-box',
      slots: body.slots,
      slotById,
      slotBindings,
      allowEmptyNodeFallback: hasExplicitPools,
    });

    const matchedTags: string[] = [];
    const targetSlotAllTags: string[] = [];

    for (const slotId of targetSlots) {
      if (!slotById.has(slotId)) {
        items.push({
          code: 'MISSING_SLOT_REFERENCE',
          severity: 'warning',
          message: `${pool.kind === 'region' ? '地区组' : '节点池'}「${pool.name}」引用了不存在的节点槽位 ${slotId}。`,
          location: { ...location, slotId },
        });
        continue;
      }
      const entries = slotNodesById.get(slotId) ?? [];
      for (const entry of entries) {
        targetSlotAllTags.push(entry.tag);
        if (!emptyProtection.fallbackToAll && (!nodeFilter || matchNodeFilter(entry.originalName, nodeFilter))) {
          matchedTags.push(entry.tag);
        }
      }
    }

    let members: string[];
    const uniqueMatchedTags = dedupeStrings(matchedTags);
    const uniqueFallbackAllTags = dedupeStrings(
      allNodesTag ? [allNodesTag] : allInlinedNodeTags.length > 0 ? allInlinedNodeTags : targetSlotAllTags,
    );

    let effectiveGroupType = pool.type;
    if (emptyProtection.fallbackToAll && uniqueFallbackAllTags.length > 0) {
      members = uniqueFallbackAllTags;
      poolHasRealNodes.set(pool.id, true);
      items.push({
        code: 'EMPTY_POOL_FALLBACK_ALL',
        severity: 'warning',
        message: emptyProtection.message ?? `节点池「${pool.name}」已退化为引用全部节点。`,
        location,
      });
    } else if (uniqueMatchedTags.length > 0) {
      members = uniqueMatchedTags;
      poolHasRealNodes.set(pool.id, true);
    } else {
      // Never put `direct` inside a urltest outbound; downgrade to selector when empty.
      effectiveGroupType = 'select';
      members = [DIRECT_TAG];
      poolHasRealNodes.set(pool.id, false);
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'info',
        message: `${pool.kind === 'region' ? '地区组' : '节点池'}「${pool.name}」当前未匹配到任何节点，已回退到 ${DIRECT_TAG} 以确保配置有效。`,
        location,
      });
    }

    poolOutboundById.set(
      pool.id,
      buildSingboxGroupOutbound({
        tag,
        groupType: effectiveGroupType,
        outbounds: members,
        healthCheck: pool.test,
        location,
        items,
      }),
    );
  }

  // Pass 2: stability pools referencing other pool outbound tags
  for (const pool of bodyPools) {
    if (pool.kind !== 'stability') continue;
    const tag = poolTagById.get(pool.id)!;
    const location = poolCompatibilityLocation(pool, hasExplicitPools);
    const resolvedMembers = resolveStabilityPoolMembers(pool, poolTagById, items, hasExplicitPools);
    let members: string[];
    let effectiveGroupType = pool.type;
    if (resolvedMembers.length > 0) {
      members = resolvedMembers;
      const memberIds = pool.members ?? [];
      poolHasRealNodes.set(
        pool.id,
        memberIds.some((memberId) => poolHasRealNodes.get(memberId)),
      );
    } else if (allInlinedNodeTags.length > 0 || allNodesTag) {
      members = allNodesTag ? [allNodesTag] : [...allInlinedNodeTags];
      poolHasRealNodes.set(pool.id, true);
      items.push({
        code: 'EMPTY_POOL_FALLBACK_ALL',
        severity: 'warning',
        message: `稳定性节点池「${pool.name}」无可用成员池，已退化为引用全部节点。`,
        location,
      });
    } else {
      // Never put `direct` inside a urltest outbound; downgrade to selector when empty.
      effectiveGroupType = 'select';
      members = [DIRECT_TAG];
      poolHasRealNodes.set(pool.id, false);
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'info',
        message: `稳定性节点池「${pool.name}」没有可用成员或节点，已回退到 ${DIRECT_TAG} 以确保配置有效。`,
        location,
      });
    }

    poolOutboundById.set(
      pool.id,
      buildSingboxGroupOutbound({
        tag,
        groupType: effectiveGroupType,
        outbounds: members,
        healthCheck: pool.test,
        location,
        items,
      }),
    );
  }

  const regionOutbounds: SingboxOutbound[] = bodyPools
    .map((pool) => poolOutboundById.get(pool.id))
    .filter((ob): ob is SingboxOutbound => ob !== undefined);

  // 5b. Build per-provider & all-nodes groups when combineMode === 'perProvider'
  const airportOutbounds: SingboxOutbound[] = [];
  if (perProviderMode) {
    for (const slot of body.slots) {
      const slotTag = airportTagBySlotId.get(slot.id);
      if (!slotTag) continue;
      const slotNodeTags = (slotNodesById.get(slot.id) ?? []).map((n) => n.tag);
      const members = slotNodeTags.length > 0 ? slotNodeTags : [DIRECT_TAG];
      airportOutbounds.push(
        buildSingboxGroupOutbound({
          tag: slotTag,
          groupType: slotNodeTags.length > 0 ? 'url-test' : 'select',
          outbounds: members,
          location: { slotId: slot.id },
          items,
        }),
      );
    }
    if (allNodesTag) {
      const allNodeTags = allInlinedNodes.map((n) => n.tag);
      const members = allNodeTags.length > 0 ? allNodeTags : [DIRECT_TAG];
      airportOutbounds.push(
        buildSingboxGroupOutbound({
          tag: allNodesTag,
          groupType: 'select',
          outbounds: members,
          location: undefined,
          items,
        }),
      );
    }
  }

  // 6. Build AppCard outbounds
  // Pre-compute whether a card group actually has any real proxy path (important for dns-leak-guard empty handling)
  const cardOutbounds: SingboxOutbound[] = [];
  const emittedCardTags = new Set<string>();
  const cardEmittedAsReject = new Map<string, { kind: 'reject'; drop: boolean }>(cardRejectTarget);

  const resolveCandidatesForCard = (
    card: ResolvedTemplateCard,
  ): { outbounds: string[]; fallbackReject: 'reject' | 'drop' | null; hasDirect: boolean; hasRealProxy: boolean } => {
    const outbounds: string[] = [];
    let fallbackReject: 'reject' | 'drop' | null = null;
    let hasDirect = false;
    let hasRealProxy = false;

    for (const ref of card.effective.group.candidates) {
      switch (ref.kind) {
        case 'builtin':
          if (ref.id === 'DIRECT') {
            outbounds.push(DIRECT_TAG);
            hasDirect = true;
          } else if (ref.id === 'REJECT' || ref.id === 'REJECT-DROP') {
            if (!fallbackReject) {
              fallbackReject = ref.id === 'REJECT-DROP' ? 'drop' : 'reject';
            }
          }
          break;
        case 'slot': {
          if (multiSlot && !ref.filter && (card.cardId === 'auto-select' || card.cardId === 'proxy-select')) {
            if (card.cardId === 'proxy-select' && perProviderMode) {
              for (const slotTag of airportTagBySlotId.values()) {
                outbounds.push(slotTag);
              }
              if (allNodesTag) outbounds.push(allNodesTag);
              if (allInlinedNodes.length > 0) hasRealProxy = true;
            } else {
              for (const entry of allInlinedNodes) {
                outbounds.push(entry.tag);
                hasRealProxy = true;
              }
            }
            break;
          }
          if (!slotById.has(ref.slotId)) {
            items.push({
              code: 'MISSING_SLOT_REFERENCE',
              severity: 'warning',
              message: `应用组件「${card.effective.name}」引用了不存在的节点槽位 ${ref.slotId}。`,
              location: { cardId: card.cardId, slotId: ref.slotId },
            });
            break;
          }
          const entries = slotNodesById.get(ref.slotId) ?? [];
          if (ref.filter) {
            for (const pattern of [ref.filter.include, ref.filter.exclude]) {
              if (!pattern) continue;
              for (const issue of detectRegexDialectIssues(pattern, 'sing-box')) {
                items.push({
                  code: 'REGEX_DIALECT_WARNING',
                  severity: 'warning',
                  message: `应用组件「${card.effective.name}」的节点筛选正则：${issue.message}`,
                  location: { cardId: card.cardId, slotId: ref.slotId },
                });
              }
            }
          }
          for (const entry of entries) {
            if (!ref.filter || matchNodeFilter(entry.originalName, ref.filter)) {
              outbounds.push(entry.tag);
              hasRealProxy = true;
            }
          }
          break;
        }
        case 'region':
        case 'pool': {
          const targetId = ref.kind === 'pool' ? ref.poolId : ref.regionGroupId;
          const poolTag = poolTagById.get(targetId);
          if (!poolTag) {
            items.push({
              code: ref.kind === 'pool' ? 'MISSING_POOL_REFERENCE' : 'MISSING_REGION_REFERENCE',
              severity: 'warning',
              message:
                ref.kind === 'pool'
                  ? `应用组件「${card.effective.name}」引用了不存在的节点池 ${targetId}。`
                  : `应用组件「${card.effective.name}」引用了不存在的地区组 ${targetId}。`,
              location:
                ref.kind === 'pool'
                  ? { cardId: card.cardId, poolId: targetId }
                  : { cardId: card.cardId, regionGroupId: targetId },
            });
            break;
          }
          outbounds.push(poolTag);
          if (poolHasRealNodes.get(targetId)) {
            hasRealProxy = true;
          }
          break;
        }
        case 'card': {
          if (ref.cardId === card.cardId) break;
          if (cardEmittedAsReject.has(ref.cardId)) {
            const rej = cardEmittedAsReject.get(ref.cardId)!;
            if (!fallbackReject) fallbackReject = rej.drop ? 'drop' : 'reject';
            break;
          }
          const refTag = cardTagById.get(ref.cardId);
          if (!refTag) {
            items.push({
              code: 'MISSING_CARD_REFERENCE',
              severity: 'warning',
              message: `应用组件「${card.effective.name}」引用了未启用或不存在的组件 ${ref.cardId}。`,
              location: { cardId: card.cardId },
            });
            break;
          }
          outbounds.push(refTag);
          hasRealProxy = true;
          break;
        }
      }
    }

    if (card.cardId === 'proxy-select' && perProviderMode) {
      const providerTags = [...airportTagBySlotId.values(), ...(allNodesTag ? [allNodesTag] : [])];
      const directIdx = outbounds.indexOf(DIRECT_TAG);
      if (directIdx >= 0) {
        outbounds.splice(directIdx, 0, ...providerTags);
      } else {
        outbounds.push(...providerTags);
      }
      if (allInlinedNodes.length > 0) hasRealProxy = true;
    }

    return {
      outbounds: dedupeStrings(outbounds),
      fallbackReject,
      hasDirect,
      hasRealProxy,
    };
  };

  for (const card of activeCards) {
    if (cardEmittedAsReject.has(card.cardId)) continue;
    const tag = cardTagById.get(card.cardId)!;
    const resolvedCandidates = resolveCandidatesForCard(card);

    // Special safety for dns-leak-guard final card when ZERO proxy nodes exist in any slot
    if (
      card.cardId === DNS_LEAK_FINAL_CARD_ID &&
      !resolvedCandidates.hasDirect &&
      resolvedCandidates.fallbackReject &&
      allInlinedNodes.length === 0
    ) {
      cardEmittedAsReject.set(card.cardId, {
        kind: 'reject',
        drop: resolvedCandidates.fallbackReject === 'drop',
      });
      cardTagById.delete(card.cardId);
      items.push({
        code: 'MODULE_NOTE',
        severity: 'warning',
        message: `防 DNS 泄漏兜底组「${card.effective.name}」当前无任何可用代理节点，已在路由末尾追加拦截规则（禁止回退到 direct）。`,
        location: { cardId: card.cardId, moduleId: 'dns-leak-guard' },
      });
      continue;
    }

    let members = resolvedCandidates.outbounds;
    let effectiveGroupType = card.effectiveGroupType;
    if (members.length === 0) {
      if (resolvedCandidates.fallbackReject && !resolvedCandidates.hasDirect) {
        cardEmittedAsReject.set(card.cardId, {
          kind: 'reject',
          drop: resolvedCandidates.fallbackReject === 'drop',
        });
        cardTagById.delete(card.cardId);
        continue;
      }
      // Never put `direct` inside a urltest outbound; downgrade to selector when empty.
      effectiveGroupType = 'select';
      members = [DIRECT_TAG];
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'info',
        message: `策略组「${card.effective.name}」当前没有可用出站成员，已回退到 ${DIRECT_TAG}。`,
        location: { cardId: card.cardId },
      });
    }

    const groupOutbound = buildSingboxGroupOutbound({
      tag,
      groupType: effectiveGroupType,
      outbounds: members,
      healthCheck: card.effective.group.test,
      location: { cardId: card.cardId },
      items,
    });
    cardOutbounds.push(groupOutbound);
    emittedCardTags.add(tag);
  }

  // 7. Build `route.rule_set` entries
  const ruleSets: SingboxRuleSet[] = [];
  const emittedRuleSetTags = new Set<string>();
  const providerRuleSetTag = new Map<string, string>();
  const providerNativePrivate = new Set<string>();

  const ensureGeoRuleSet = (
    kind: 'geosite' | 'geoip',
    rawName: string,
    updateIntervalSec = 28_800,
  ): { nativePrivate?: boolean; tag?: string } => {
    const name = rawName.trim().toLowerCase();
    if (!name) return {};
    if (kind === 'geoip' && name === 'private') {
      return { nativePrivate: true };
    }
    const tag = sanitizeSingboxRuleSetTag(`${kind}-${name}`, `${kind}-rule`);
    if (!emittedRuleSetTags.has(tag)) {
      emittedRuleSetTags.add(tag);
      ruleSets.push({
        tag,
        type: 'remote',
        format: 'binary',
        url: `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/${kind}/${encodeURIComponent(name)}.srs`,
        update_interval: formatSingboxDuration(updateIntervalSec),
      });
    }
    return { tag };
  };

  for (const provider of rulesetPlan.providers) {
    const tag = sanitizeSingboxRuleSetTag(provider.id, 'rule-set');
    const inlineLines = inlinePayloads.get(provider.id);

    if (inlineLines && inlineLines.length > 0) {
      const headlessRules = compileInlineRulePayloadToHeadlessRules(inlineLines, provider.behavior);
      if (headlessRules.length > 0) {
        if (!emittedRuleSetTags.has(tag)) {
          emittedRuleSetTags.add(tag);
          ruleSets.push({
            tag,
            type: 'inline',
            rules: headlessRules,
          });
        }
        providerRuleSetTag.set(provider.id, tag);
      } else {
        items.push({
          code: 'UNSUPPORTED_REMOTE_FORMAT',
          severity: 'warning',
          message: `内联规则集 ${provider.id} 未包含任何 sing-box 支持的规则条目，已跳过。`,
          location: { providerId: provider.id },
        });
      }
      continue;
    }

    switch (provider.source.kind) {
      case 'geosite-hosted': {
        const res = ensureGeoRuleSet('geosite', provider.source.name, provider.updateIntervalSec);
        if (res.tag) providerRuleSetTag.set(provider.id, res.tag);
        break;
      }
      case 'geoip-ruleset': {
        const res = ensureGeoRuleSet('geoip', provider.source.name, provider.updateIntervalSec);
        if (res.nativePrivate) {
          providerNativePrivate.add(provider.id);
        } else if (res.tag) {
          providerRuleSetTag.set(provider.id, res.tag);
        }
        break;
      }
      case 'ruleset': {
        if (!isHttpUrl(provider.source.url)) {
          items.push({
            code: 'MISSING_RULESET_URL',
            severity: 'warning',
            message: `自托管规则集 ${provider.source.ruleSetId} 缺少外部访问基地址（baseUrl），已跳过。`,
            location: { providerId: provider.id },
          });
          break;
        }
        if (!emittedRuleSetTags.has(tag)) {
          emittedRuleSetTags.add(tag);
          ruleSets.push({
            tag,
            type: 'remote',
            format: 'source',
            url: provider.source.url,
            update_interval: formatSingboxDuration(provider.updateIntervalSec),
          });
        }
        providerRuleSetTag.set(provider.id, tag);
        break;
      }
      case 'remote':
      case 'catalog': {
        const rawUrl = provider.source.url;
        if (!isHttpUrl(rawUrl)) {
          items.push({
            code: 'MISSING_RULESET_URL',
            severity: 'warning',
            message: `规则集 ${provider.id} 缺少有效的远程 URL，已跳过。`,
            location: { providerId: provider.id },
          });
          break;
        }

        const lowerUrl = rawUrl.toLowerCase();
        const metaMatch = rawUrl.match(METACUBEX_GEO_RE);
        if (lowerUrl.endsWith('.srs')) {
          if (!emittedRuleSetTags.has(tag)) {
            emittedRuleSetTags.add(tag);
            ruleSets.push({
              tag,
              type: 'remote',
              format: 'binary',
              url: rawUrl,
              update_interval: formatSingboxDuration(provider.updateIntervalSec),
            });
          }
          providerRuleSetTag.set(provider.id, tag);
        } else if (lowerUrl.endsWith('.json')) {
          if (!emittedRuleSetTags.has(tag)) {
            emittedRuleSetTags.add(tag);
            ruleSets.push({
              tag,
              type: 'remote',
              format: 'source',
              url: rawUrl,
              update_interval: formatSingboxDuration(provider.updateIntervalSec),
            });
          }
          providerRuleSetTag.set(provider.id, tag);
        } else if (metaMatch) {
          const geoKind = metaMatch[1].toLowerCase();
          const geoName = metaMatch[2];
          const rewrittenUrl = `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/geo/${geoKind}/${geoName}.srs`;
          if (!emittedRuleSetTags.has(tag)) {
            emittedRuleSetTags.add(tag);
            ruleSets.push({
              tag,
              type: 'remote',
              format: 'binary',
              url: rewrittenUrl,
              update_interval: formatSingboxDuration(provider.updateIntervalSec),
            });
          }
          providerRuleSetTag.set(provider.id, tag);
        } else {
          items.push({
            code: 'UNSUPPORTED_REMOTE_FORMAT',
            severity: 'warning',
            message: `sing-box ${SINGBOX_MIN_VERSION} 的 route.rule_set 仅支持 .srs（binary）或 .json（source）格式，已跳过远程列表 ${rawUrl}。`,
            location: { providerId: provider.id },
          });
        }
        break;
      }
    }
  }

  // 8. Compile `route.rules`
  const routeRules: SingboxRule[] = [];
  let skippedRules = 0;

  if (output === 'full') {
    routeRules.push({ action: 'sniff' });
    routeRules.push({ protocol: 'dns', action: 'hijack-dns' });
  }

  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const b of rulesetPlan.bindings) {
    bindingMap.set(`${b.cardId}:${b.matcherIndex}`, b);
  }

  const resolveCardRuleTarget = (cardId: string): ResolvedRuleTarget | null => {
    const rejectTarget = cardEmittedAsReject.get(cardId);
    if (rejectTarget) return rejectTarget;
    const tag = cardTagById.get(cardId);
    if (tag && emittedCardTags.has(tag)) return { kind: 'outbound', tag };
    return null;
  };

  for (const card of activeCards) {
    if (card.effective.hidden) continue;
    const target = resolveCardRuleTarget(card.cardId);
    if (!target) continue;

    card.effective.matchers.forEach((matcher, matcherIndex) => {
      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const compiled = compileConditionToSingboxRule(cond, card.cardId, ensureGeoRuleSet, items);
          if (!compiled) {
            skippedRules += 1;
            continue;
          }
          routeRules.push(attachRuleTarget(compiled, target));
        }
        return;
      }

      const binding = bindingMap.get(`${card.cardId}:${matcherIndex}`);
      if (!binding || binding.providerIds.length === 0) {
        skippedRules += 1;
        return;
      }

      const ruleSetTags: string[] = [];
      let emittedPrivate = false;
      for (const providerId of binding.providerIds) {
        if (providerNativePrivate.has(providerId)) {
          routeRules.push(attachRuleTarget({ ip_is_private: true }, target));
          emittedPrivate = true;
          continue;
        }
        const rsTag = providerRuleSetTag.get(providerId);
        if (rsTag) {
          ruleSetTags.push(rsTag);
        } else {
          skippedRules += 1;
        }
      }

      if (ruleSetTags.length > 0) {
        routeRules.push(attachRuleTarget({ rule_set: dedupeStrings(ruleSetTags) }, target));
      } else if (!emittedPrivate && binding.providerIds.length === 0) {
        skippedRules += 1;
      }
    });
  }

  // 9. Resolve `route.final`
  let routeFinalTag: string;
  let finalRejectCatchAll: { drop: boolean } | null = null;

  const resolvePolicyRef = (ref: PolicyRef): ResolvedRuleTarget | null => {
    switch (ref.kind) {
      case 'builtin':
        if (ref.id === 'DIRECT') return { kind: 'outbound', tag: DIRECT_TAG };
        return { kind: 'reject', drop: ref.id === 'REJECT-DROP' };
      case 'card':
        return resolveCardRuleTarget(ref.cardId);
      case 'region':
      case 'pool': {
        const targetId = ref.kind === 'pool' ? ref.poolId : ref.regionGroupId;
        const tag = poolTagById.get(targetId);
        return tag ? { kind: 'outbound', tag } : null;
      }
      case 'slot': {
        const first = slotNodesById.get(ref.slotId)?.[0];
        return first ? { kind: 'outbound', tag: first.tag } : null;
      }
    }
  };

  const resolvedFinal = resolvePolicyRef(body.final);
  if (!resolvedFinal) {
    routeFinalTag = DIRECT_TAG;
    items.push({
      code: 'GROUP_FALLBACK_DIRECT',
      severity: 'warning',
      message: `无法解析兜底策略，route.final 已回退为 ${DIRECT_TAG}。`,
    });
  } else if (resolvedFinal.kind === 'reject') {
    routeFinalTag = DIRECT_TAG;
    finalRejectCatchAll = { drop: resolvedFinal.drop };
  } else {
    routeFinalTag = resolvedFinal.tag;
  }

  if (finalRejectCatchAll) {
    routeRules.push(
      finalRejectCatchAll.drop
        ? { network: ['tcp', 'udp'], action: 'reject', method: 'drop' }
        : { network: ['tcp', 'udp'], action: 'reject' },
    );
  }

  // 10. Assemble ordered `outbounds`: card groups -> region groups -> per-provider groups -> inlined nodes -> direct
  const outbounds: SingboxOutbound[] = [
    ...cardOutbounds,
    ...regionOutbounds,
    ...airportOutbounds,
    ...allInlinedNodes.map((n) => n.outbound),
    { type: 'direct', tag: DIRECT_TAG },
  ];

  // Determine proxy detour tag for remote DNS (never `direct`)
  let proxyDetourTag: string | null = null;
  if (dnsLeakGuardActive) {
    if (routeFinalTag !== DIRECT_TAG) {
      proxyDetourTag = routeFinalTag;
    } else if (cardTagById.has('proxy-select') && emittedCardTags.has(cardTagById.get('proxy-select')!)) {
      proxyDetourTag = cardTagById.get('proxy-select')!;
    }
  } else if (cardTagById.has('proxy-select') && emittedCardTags.has(cardTagById.get('proxy-select')!)) {
    proxyDetourTag = cardTagById.get('proxy-select')!;
  } else if (routeFinalTag !== DIRECT_TAG) {
    proxyDetourTag = routeFinalTag;
  }

  // 11. Assemble full or minimal sing-box 1.12 document
  let doc: Record<string, unknown>;

  if (output === 'minimal') {
    items.push({
      code: 'MINIMAL_OMITTED_SECTIONS',
      severity: 'info',
      message: 'minimal 档位已省略 log、dns、inbounds 与 experimental 段，仅输出 outbounds 与 route。',
    });

    const routeDoc: Record<string, unknown> = {
      rules: routeRules,
      ...(ruleSets.length > 0 ? { rule_set: ruleSets } : {}),
      final: routeFinalTag,
    };

    doc = {
      outbounds,
      route: routeDoc,
    };
  } else {
    const general = body.general ?? {};
    const ipv6 = general.ipv6 !== false;

    const logDoc: Record<string, unknown> =
      general.logLevel === 'silent'
        ? { disabled: true }
        : {
            level: general.logLevel === 'warning' ? 'warn' : (general.logLevel ?? 'info'),
          };

    const dnsBuilt = buildSingboxDns({
      dns: body.dns,
      ipv6,
      dnsLeakGuardActive,
      proxyDetourTag,
      emittedRuleSetTags,
      items,
    });

    const inbounds: Record<string, unknown>[] = [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: general.allowLan ? '::' : '127.0.0.1',
        listen_port: general.mixedPort ?? 7890,
      },
    ];

    const routeDoc: Record<string, unknown> = {
      rules: routeRules,
      ...(ruleSets.length > 0 ? { rule_set: ruleSets } : {}),
      final: routeFinalTag,
      auto_detect_interface: true,
      default_domain_resolver: dnsBuilt.defaultDomainResolver,
    };

    const experimentalDoc: Record<string, unknown> = {
      cache_file: {
        enabled: true,
        ...(dnsBuilt.isFakeIp ? { store_fakeip: true } : {}),
      },
    };

    doc = {
      log: logDoc,
      dns: dnsBuilt.dns,
      inbounds,
      outbounds,
      route: routeDoc,
      experimental: experimentalDoc,
    };
  }

  // 12. Optional clientPatches['sing-box'] JSON deep-merge
  const rawPatch = body.clientPatches?.['sing-box'];
  if (rawPatch?.trim()) {
    try {
      const parsedPatch: unknown = JSON.parse(rawPatch);
      if (isPlainObject(parsedPatch)) {
        doc = deepMergeObjects(doc, parsedPatch);
      } else {
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'clientPatches["sing-box"] 必须是 JSON 对象，已忽略。',
        });
      }
    } catch {
      items.push({
        code: 'INVALID_CLIENT_PATCH',
        severity: 'warning',
        message: 'clientPatches["sing-box"] JSON 解析失败，已忽略。',
      });
    }
  }

  const content = `${JSON.stringify(doc, null, 2)}\n`;

  return {
    client: 'sing-box',
    output,
    contentType: 'application/json; charset=utf-8',
    extension: '.json',
    content,
    report: {
      client: 'sing-box',
      output,
      items,
      stats: {
        proxyProviders: 0,
        inlineProxies: allInlinedNodes.length,
        proxyGroups: cardOutbounds.length + regionOutbounds.length,
        ruleProviders: ruleSets.length,
        rules: routeRules.length,
        skippedRules,
        appliedModules,
        skippedModules,
      },
    },
  };
}

function buildSingboxGroupOutbound(params: {
  tag: string;
  groupType: NodePool['type'];
  outbounds: string[];
  healthCheck?: NodePool['test'];
  location: CompatibilityItem['location'];
  items: CompatibilityItem[];
}): SingboxOutbound {
  const { tag, groupType, outbounds, healthCheck, location, items } = params;

  if (!SINGBOX_CAPS.supportedGroupTypes.has(groupType)) {
    items.push({
      code: 'UNSUPPORTED_GROUP_TYPE',
      severity: 'info',
      message: `sing-box ${SINGBOX_MIN_VERSION} 不原生支持策略组类型 ${groupType}（组「${tag}」），已降级为 urltest。`,
      location,
    });
  }

  if (groupType === 'select') {
    return {
      type: 'selector',
      tag,
      outbounds,
      default: outbounds[0],
    };
  }

  const test = {
    url: healthCheck?.url || DEFAULT_HEALTH_CHECK.url,
    interval: healthCheck?.intervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
    tolerance: healthCheck?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
  };

  return {
    type: 'urltest',
    tag,
    outbounds,
    url: test.url,
    interval: formatSingboxDuration(test.interval),
    tolerance: test.tolerance,
  };
}
