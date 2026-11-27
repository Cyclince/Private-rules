import type { TemplateModuleBinding } from '../../../shared/schemas/template';
import type { ResolvedTemplate } from '../model';
import { upsertClientPatchSection } from './helpers';
import type { EnhancementModule } from './types';

export const SNIFFER_MODULE_ID = 'sniffer';
export const SNIFFER_PATCH_KEY = 'sniffer';

/**
 * Sniffer block written by the mihomo compiler (`compileSnifferSection`), reproduced here only
 * for documentation / tests. The compiler stays the single source of truth: this module never
 * adds a second `sniffer:` mapping.
 */
export const MIHOMO_DEFAULT_SNIFFER_PATCH = `sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  override-destination: true
  sniff:
    HTTP:
      ports:
        - 80
        - 8080-8880
      override-destination: true
    TLS:
      ports:
        - 443
        - 8443
    QUIC:
      ports:
        - 443
        - 8443
  skip-domain:
    - Mijia Cloud
    - +.push.apple.com
    - +.lan
    - +.local
`;

/** Patch used when the user explicitly turns traffic sniffing off for a mihomo template. */
export const MIHOMO_SNIFFER_DISABLED_PATCH = `# 由增强模块「流量嗅探」关闭（mihomo 默认写出 sniffer 段，这里显式禁用）
sniffer:
  enable: false
`;

/**
 * True when the mihomo compiler should emit its sniffer block for a template.
 *
 * T1 writes `sniffer` unconditionally; templates that predate the module (no binding at all)
 * keep that behaviour so existing outputs stay byte-identical. An explicit
 * `{ id: 'sniffer', enabled: false }` binding turns it off.
 */
export function shouldEmitSniffer(bindings: readonly TemplateModuleBinding[]): boolean {
  const binding = bindings.find((entry) => entry.id === SNIFFER_MODULE_ID);
  return binding?.enabled ?? true;
}

/**
 * Enhancement module: 流量嗅探 (design §5.2, 识别准确度).
 *
 * The mihomo compiler already writes exactly one sniffer section (T1), so enabling the module
 * changes nothing — it only guarantees "one sniffer definition" semantics for the UI and for
 * the `shouldEmitSniffer` seam. Disabling it neutralises the compiler default through a
 * `clientPatches.mihomo` patch, because the module layer cannot delete a compiler-emitted key.
 */
export const snifferModule: EnhancementModule = {
  id: SNIFFER_MODULE_ID,
  name: '流量嗅探',
  icon: '🔍',
  group: 'accuracy',
  description:
    '从 TLS / QUIC 握手还原域名，让端口复用与应用内流量也能命中域名规则；mihomo 默认开启，关闭时显式禁用嗅探。',
  defaultEnabled: true,
  tierDefaults: { simple: false, advanced: true, pro: true },
  order: 12,
  affects: ['runtime'],
  conflictsWith: [],
  supportedClients: ['mihomo'],
  apply(template: ResolvedTemplate): ResolvedTemplate {
    // Single source of truth: keep the compiler's block, never append a second `sniffer:` key.
    return template;
  },
  onDisabled(template: ResolvedTemplate): ResolvedTemplate {
    return upsertClientPatchSection(template, 'mihomo', SNIFFER_PATCH_KEY, MIHOMO_SNIFFER_DISABLED_PATCH).template;
  },
};
