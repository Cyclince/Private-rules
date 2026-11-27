/**
 * Fixed 7-layer rule stratification stages (design §10.10).
 *
 * Deliberately dependency-free so domain helpers and UI components can import
 * stage constants without pulling the zod schema graph into lazy chunks.
 */
export const STAGE_VALUES = ['pre-direct', 'app', 'proxy-fallback', 'ip', 'domestic', 'port', 'final'] as const;
export type Stage = (typeof STAGE_VALUES)[number];
