import { TEMPLATE_CLIENT_IDS } from '../../../shared/clients';
import type { TemplateModuleBinding } from '../../../shared/schemas/template';
import type {
  EnhancementModuleMetadata,
  ModuleConflict,
  ModuleGroupDefinition,
  ModuleValidationError,
  ModuleValidationResult,
} from './types';

/** Ordered definitions of enhancement module UI groups (design §5.2). */
export const MODULE_GROUP_DEFINITIONS: readonly ModuleGroupDefinition[] = [
  {
    id: 'dns-privacy',
    name: 'DNS 与隐私',
    icon: '🛡️',
    description: '控制上游 DNS 行为、防止请求泄漏、阻断应用绕过加密 DNS，并拦截常见跟踪与遥测域名。',
    order: 10,
  },
  {
    id: 'accuracy',
    name: '识别准确度',
    icon: '🔍',
    description: '从加密流量还原域名、减少不必要的 DNS 触发，提升域名与 IP 规则分流准确度。',
    order: 20,
  },
  {
    id: 'direct',
    name: '直连优化',
    icon: '🏠',
    description: '将内网穿透、系统推送、国内常用应用与大流量下载直连分流。',
    order: 30,
  },
  {
    id: 'runtime',
    name: '运行',
    icon: '⚙️',
    description: '客户端运行时参数，例如路由器 / 透明代理下的 TUN 模式。',
    order: 40,
  },
];

/**
 * Pure metadata registry for all built-in enhancement modules (zero `zod` or
 * compile-time rule payloads so the UI editor can list modules and check conflicts
 * without pulling compiler dependencies into client bundles).
 */
export const ENHANCEMENT_MODULE_METADATA: readonly EnhancementModuleMetadata[] = [
  {
    id: 'privacy-tracker-block',
    name: '隐私跟踪拦截',
    icon: '🕵️',
    group: 'dns-privacy',
    description: '在规则最前面拦截常见统计、归因与崩溃上报域名（不含系统与厂商推送通道），减少应用对使用行为的采集。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: false, pro: true },
    order: 8,
    affects: ['rules', 'groups'],
    conflictsWith: [],
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'block-encrypted-dns',
    name: '阻断加密 DNS',
    icon: '🚫',
    group: 'dns-privacy',
    description: '在规则最前面拦截 853 端口与常见 DoH / DoT / DoQ 域名和 IP，迫使终端使用配置中的 DNS。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: false, pro: true },
    order: 10,
    affects: ['rules', 'groups'],
    conflictsWith: ['dns-leak-guard'],
    conflictReasons: {
      'dns-leak-guard':
        '「阻断加密 DNS」在规则最顶部拦截 DoH/DoT 域名与 IP，与开启 respect-rules 的「防 DNS 泄漏」同时启用会阻断内核自身的上游加密 DNS 查询。',
    },
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'sniffer',
    name: '流量嗅探',
    icon: '🔍',
    group: 'accuracy',
    description:
      '从 TLS / QUIC 握手还原域名，让端口复用与应用内流量也能命中域名规则；mihomo 默认开启，关闭时不写入嗅探段。',
    defaultEnabled: true,
    tierDefaults: { simple: false, advanced: true, pro: true },
    order: 12,
    affects: ['runtime'],
    conflictsWith: [],
    supportedClients: ['mihomo'],
  },
  {
    id: 'disable-quic',
    name: '禁用 QUIC',
    icon: '🛑',
    group: 'accuracy',
    description: '拦截 UDP 443 的 QUIC 流量，促使浏览器与应用回退到 TCP / TLS，提升规则识别与分流准确度。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: false, pro: true },
    order: 14,
    affects: ['rules', 'groups'],
    conflictsWith: [],
    supportedClients: ['mihomo', 'stash', 'surge', 'sing-box', 'loon', 'shadowrocket'],
  },
  {
    id: 'game-download-direct',
    name: '游戏下载直连',
    icon: '🎮',
    group: 'direct',
    description: '在前置直连层加入 Steam CDN 与主流游戏平台下载域名直连，节省代理流量并提升下载速度。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: false, pro: true },
    order: 20,
    affects: ['rules', 'groups', 'providers'],
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'apple-push-direct',
    name: 'Apple 推送直连',
    icon: '🍎',
    group: 'direct',
    description: '把 APNs 推送域名（push.apple.com 等）放到前置直连层，iPhone 推送不再绕代理，到达更及时。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: true, pro: true },
    order: 22,
    affects: ['rules', 'groups'],
    conflictsWith: [],
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'domestic-apps-direct',
    name: '国内常用应用防误代理',
    icon: '📱',
    group: 'direct',
    description:
      '把微信、支付宝与主要银行的常用域名固定走直连，避免节点误分组导致支付、登录或消息收发失败（三档都推荐开启）。',
    defaultEnabled: true,
    tierDefaults: { simple: true, advanced: true, pro: true },
    order: 26,
    affects: ['rules', 'groups'],
    conflictsWith: [],
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'tunnel-direct',
    name: '局域网与内网穿透直连',
    icon: '🔗',
    group: 'direct',
    description: '在前置直连层加入 Tailscale、Cloudflare Tunnel、ZeroTier 等内网穿透与组网的域名、IP 与端口直连规则。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: true, pro: true },
    order: 30,
    affects: ['rules', 'groups', 'providers'],
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'bt-direct',
    name: 'BT / PT 直连',
    icon: '🧲',
    group: 'direct',
    description: '识别常见 BT 客户端进程与默认端口并直连，避免机场风控判定为 BT 流量，也避免 PT 上传走共享节点。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: false, pro: true },
    order: 34,
    affects: ['rules', 'groups'],
    conflictsWith: [],
    supportedClients: [...TEMPLATE_CLIENT_IDS],
  },
  {
    id: 'dns-leak-guard',
    name: '防 DNS 泄漏',
    icon: '🛡️',
    group: 'dns-privacy',
    description:
      '开启 DNS 规则跟随（respect-rules），移除系统 DNS，并将兜底出口改为不含 DIRECT 的专用代理组（为空时回退拦截）。',
    defaultEnabled: true,
    tierDefaults: { simple: true, advanced: true, pro: true },
    order: 40,
    affects: ['dns', 'groups', 'final'],
    conflictsWith: ['block-encrypted-dns'],
    conflictReasons: {
      'block-encrypted-dns':
        '防 DNS 泄漏会开启 respect-rules 使内核上游 DoH/DoT 查询走规则表，与「阻断加密 DNS」在顶部拦截 DoH/DoT 域名及 IP 冲突，会导致 DNS 死锁。',
    },
    supportedClients: ['mihomo', 'sing-box'],
  },
  {
    id: 'ip-no-resolve',
    name: 'IP 规则补 no-resolve',
    icon: '📌',
    group: 'accuracy',
    description:
      '为目标 IP 类规则（IP-CIDR / IP-ASN / GEOIP）与 ipcidr 行为的规则集补充 no-resolve，避免提前触发 DNS 解析。',
    defaultEnabled: true,
    tierDefaults: { simple: true, advanced: true, pro: true },
    order: 50,
    affects: ['rules', 'providers'],
    supportedClients: ['mihomo', 'stash', 'surge', 'loon', 'quantumult-x', 'shadowrocket'],
  },
  {
    id: 'tun-mode',
    name: 'TUN 模式（路由器 / 透明代理）',
    icon: '🚇',
    group: 'runtime',
    description:
      '为 OpenClash 等虚拟网关写入 mihomo 的 tun 段（auto-route、DNS 劫持）。图形客户端请用自带的 TUN 开关，默认不写。',
    defaultEnabled: false,
    tierDefaults: { simple: false, advanced: false, pro: false },
    order: 60,
    affects: ['runtime'],
    conflictsWith: [],
    supportedClients: ['mihomo'],
  },
];

const METADATA_MAP = new Map<string, EnhancementModuleMetadata>(
  ENHANCEMENT_MODULE_METADATA.map((mod) => [mod.id, mod]),
);

export function requireModuleMetadata(id: string): EnhancementModuleMetadata {
  const mod = METADATA_MAP.get(id);
  if (!mod) {
    throw new Error(`Missing built-in enhancement module metadata: ${id}`);
  }
  return mod;
}

export function listEnhancementModuleMetadata(): readonly EnhancementModuleMetadata[] {
  return ENHANCEMENT_MODULE_METADATA;
}

/**
 * Validates a set of template module bindings for unknown modules, mutually
 * conflicting enabled modules, and optionally module-specific params.
 */
export function validateModuleCombinationMetadata<T extends EnhancementModuleMetadata>(
  bindings: readonly TemplateModuleBinding[],
  registry?: readonly T[],
  validateParams?: (mod: T, params: Record<string, unknown>) => string | null,
): ModuleValidationResult {
  const regMap: Map<string, T> = registry
    ? new Map(registry.map((mod) => [mod.id, mod]))
    : (METADATA_MAP as Map<string, T>);
  const enabledBindings = bindings.filter((b) => b.enabled);
  const enabledSet = new Set(enabledBindings.map((b) => b.id));
  const conflicts: ModuleConflict[] = [];
  const errors: ModuleValidationError[] = [];
  const seenConflictPairs = new Set<string>();

  for (const binding of enabledBindings) {
    const mod = regMap.get(binding.id);
    if (!mod) {
      errors.push({
        code: 'UNKNOWN_MODULE',
        moduleId: binding.id,
        message: `未知的增强模块：${binding.id}。`,
      });
      continue;
    }

    if (validateParams && binding.params !== undefined) {
      const paramError = validateParams(mod, binding.params);
      if (paramError) {
        errors.push({
          code: 'INVALID_MODULE_PARAMS',
          moduleId: mod.id,
          message: `增强模块 ${mod.name}（${mod.id}）参数无效：${paramError}`,
        });
      }
    }

    for (const conflictId of mod.conflictsWith ?? []) {
      if (!enabledSet.has(conflictId)) continue;
      const pairKey = [mod.id, conflictId].sort().join('::');
      if (seenConflictPairs.has(pairKey)) continue;
      seenConflictPairs.add(pairKey);

      const other = regMap.get(conflictId);
      const reason =
        mod.conflictReasons?.[conflictId] ??
        other?.conflictReasons?.[mod.id] ??
        `增强模块「${mod.name}」与「${other?.name ?? conflictId}」互斥，不能同时启用。`;

      conflicts.push({
        moduleA: mod.id,
        moduleB: conflictId,
        reason,
      });
      errors.push({
        code: 'MODULE_CONFLICT',
        moduleId: mod.id,
        conflictWith: conflictId,
        message: reason,
      });
    }
  }

  return {
    ok: errors.length === 0,
    conflicts,
    errors,
  };
}
