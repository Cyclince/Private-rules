import { z } from 'zod';
import type { ResolvedTemplate } from '../model';
import { upsertClientPatchSection } from './helpers';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const TUN_MODE_MODULE_ID = 'tun-mode';
export const TUN_PATCH_KEY = 'tun';

const TUN_STACKS = ['mixed', 'gvisor', 'system'] as const;

const tunModeParamsSchema = z.object({
  stack: z.enum(TUN_STACKS).optional(),
  autoRoute: z.boolean().optional(),
  autoDetectInterface: z.boolean().optional(),
  /** `any:53` makes TUN answer every DNS query; disable when another resolver owns :53. */
  dnsHijack: z.union([z.boolean(), z.array(z.string().trim().min(1))]).optional(),
});

/**
 * Enhancement module: TUN 模式（路由器 / 透明代理）(design §5.2, 运行).
 *
 * Only virtual-router setups (OpenClash, mihomo on a soft router) need a `tun:` block —
 * GUI clients ship their own switch, so nothing is written unless the user enables it.
 * The block is appended to `clientPatches.mihomo`, keeping the user's patch text intact.
 */
export const tunModeModule: EnhancementModule = {
  ...requireModuleMetadata(TUN_MODE_MODULE_ID),
  paramsSchema: tunModeParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const parsed = tunModeParamsSchema.parse(ctx.params ?? {});
    const stack = parsed.stack ?? 'mixed';
    const autoRoute = parsed.autoRoute ?? true;
    const autoDetectInterface = parsed.autoDetectInterface ?? true;
    const dnsHijack = parsed.dnsHijack ?? ['any:53'];

    const lines = [
      '# 由增强模块「TUN 模式」写入：仅适用于路由器 / 透明代理，图形客户端请用自带开关',
      `${TUN_PATCH_KEY}:`,
      '  enable: true',
      `  stack: ${stack}`,
      `  auto-route: ${autoRoute ? 'true' : 'false'}`,
      `  auto-detect-interface: ${autoDetectInterface ? 'true' : 'false'}`,
    ];
    if (Array.isArray(dnsHijack)) {
      if (dnsHijack.length > 0) {
        lines.push('  dns-hijack:');
        for (const entry of dnsHijack) lines.push(`    - ${JSON.stringify(entry)}`);
      }
    } else if (!dnsHijack) {
      lines.push('  dns-hijack: []');
    } else {
      lines.push('  dns-hijack:', '    - any:53');
    }

    return upsertClientPatchSection(template, 'mihomo', TUN_PATCH_KEY, `${lines.join('\n')}\n`).template;
  },
};
