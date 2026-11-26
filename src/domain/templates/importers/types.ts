import type { AppCard } from '../../../shared/schemas/card';
import type { TemplateBody } from '../../../shared/schemas/template';

export type ImportSourceFormat = 'acl4ssr-ini' | 'mihomo-yaml';

export type ImportCompatibilityItem = {
  severity: 'warning' | 'info';
  code: string;
  source: string;
  raw?: string;
  message: string;
};

export type ImportCompatibilityReport = {
  sourceFormat: ImportSourceFormat;
  importedCards: number;
  importedRegionGroups: number;
  importedMatchers: number;
  skippedCount: number;
  unrecognizedCount: number;
  items: ImportCompatibilityItem[];
};

export type ImportedTemplateResult = {
  baseKind: ImportSourceFormat;
  name: string;
  body: TemplateBody;
  cards: AppCard[];
  report: ImportCompatibilityReport;
};

export type ImportTemplateOptions = {
  /** Optional display name override for the imported template. */
  name?: string;
};
