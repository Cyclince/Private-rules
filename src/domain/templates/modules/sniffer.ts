import type { TemplateModuleBinding } from '../../../shared/schemas/template';
import type { ResolvedTemplate } from '../model';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const SNIFFER_MODULE_ID = 'sniffer';

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

/**
 * True when the mihomo compiler should emit its sniffer block for a template.
 *
 * T1 writes `sniffer` unconditionally; templates that predate the module (no binding at all)
 * keep that behaviour so existing outputs stay byte-identical. An explicit
 * `{ id: 'sniffer', enabled: false }` binding omits the `sniffer` section completely.
 */
export function shouldEmitSniffer(bindings: readonly TemplateModuleBinding[]): boolean {
  const binding = bindings.find((entry) => entry.id === SNIFFER_MODULE_ID);
  return binding?.enabled ?? true;
}

/**
 * Enhancement module: 流量嗅探 (design §5.2, 识别准确度).
 *
 * `compileMihomo` consults `shouldEmitSniffer(body.modules)` before emitting the compiler's
 * `sniffer:` block: enabled or unbound templates get the T1 block byte-identically, while
 * `{ id: 'sniffer', enabled: false }` omits `sniffer:` completely.
 */
export const snifferModule: EnhancementModule = {
  ...requireModuleMetadata(SNIFFER_MODULE_ID),
  apply(template: ResolvedTemplate): ResolvedTemplate {
    // Single source of truth: keep the compiler's block, never append a second `sniffer:` key.
    return template;
  },
};
