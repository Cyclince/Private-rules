import type { TemplateClientId } from '../../../shared/clients';
import type { CatalogEntry, Stage } from '../../../shared/schemas/card';
import type { TemplateBody, TemplateCardRef } from '../../../shared/schemas/template';
import type { CardLookup } from '../model';
import type { ProbeCaches } from '../probe';

export type LintSeverity = 'error' | 'warning' | 'info';

export const LINT_CODES = [
  'rule-shadowing',
  'reorder-diff',
  'missing-group-ref',
  'group-cycle',
  'empty-group',
  'missing-final',
  'client-unsupported',
  'disabled-base-group',
  'stage-order-violation',
  'subset-after-superset',
  'ip-missing-no-resolve',
  'regex-dialect-incompatible',
] as const;

export type LintCode = (typeof LINT_CODES)[number];

export type LintLocation = {
  cardId?: string;
  cardIndex?: number;
  regionGroupId?: string;
  poolId?: string;
  slotId?: string;
  matcherIndex?: number;
  ruleIndex?: number;
  stage?: Stage;
  client?: TemplateClientId;
  field?: string;
};

export type LintIssue = {
  code: LintCode;
  severity: LintSeverity;
  message: string;
  location: LintLocation;
  suggestion: string;
  details?: Record<string, unknown>;
};

export type LintTemplateInput = {
  /** Template body (allows partial `final` so `missing-final` can inspect drafts). */
  body: Omit<TemplateBody, 'final'> & { final?: TemplateBody['final'] | null };
  cards: CardLookup;
  /** Optional previous card order (or body) for computing `reorder-diff`. */
  previousCards?: readonly TemplateCardRef[];
  previousBody?: TemplateBody;
  /** Target clients to check for `client-unsupported` and `regex-dialect-incompatible`. Defaults to all 7 clients. */
  clients?: readonly TemplateClientId[];
  /** Node name preview lists keyed by `slotId`, used by `empty-group`. */
  nodeNamesBySlot?: ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>>;
  /** Flat node name preview fallback when a single slot or unkeyed preview list is provided. */
  nodeNames?: readonly string[];
  /** Optional cached rule contents for deeper shadowing, subset, and reorder-diff checks. */
  caches?: ProbeCaches;
  /** Optional catalog index (defaults to `caches?.catalogIndex`). */
  catalogIndex?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[];
  /** Additional sample domains/IPs to test in `reorder-diff`. */
  sampleTargets?: readonly string[];
};

export type LintReport = {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issues: LintIssue[];
};
