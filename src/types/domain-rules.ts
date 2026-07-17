export const UPSTREAM_RULE_PREVIEW_LIMIT = 1000;

export type RuleOptimizationMode = 'none' | 'conservative' | 'aggressive';

export type DomainRuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'IP-CIDR'
  | 'SRC-IP-CIDR'
  | 'IP-ASN'
  | 'DST-PORT'
  | 'GEOSITE'
  | 'GEOIP';

export type DomainRule = {
  id: string;
  categoryId?: string;
  value: string;
  type: DomainRuleType;
  displayType?: string;
  enabled: boolean;
  note?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  sourceId?: string;
  sourceName?: string;
  sourceType?: 'url' | 'geosite' | 'geoip';
};

export type RuleSource = {
  id: string;
  categoryId: string;
  name: string;
  url: string;
  enabled: boolean;
  lastSyncedAt?: string;
  lastStatus?: 'success' | 'error' | 'pending';
  lastCount?: number;
  lastOriginalCount?: number;
  lastError?: string;
  syncIntervalMinutes: number;
  userAgent?: string;
  sourceType?: 'url' | 'geosite' | 'geoip';
  geositeName?: string;
  geoipName?: string;
  ruleOptimization?: RuleOptimizationMode;
};

export type GeoSourceSuggestion = {
  name: string;
  sourceType: 'geosite' | 'geoip';
  recommended: boolean;
  description: string;
};

export type RuleCategory = {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  description?: string;
  note?: string;
  enabled?: boolean;
  sortOrder?: number;
  rules: DomainRule[];
  createdAt?: string;
  updatedAt: string;
  publicLinksEnabled?: boolean;
  tokenLinksEnabled?: boolean;
  sources?: RuleSource[];
  lastSyncedAt?: string;
  syncIntervalMinutes?: number;
  ruleCount?: number;
  enabledRuleCount?: number;
  manualRuleCount?: number;
  urlRuleCount?: number;
  geoRuleCount?: number;
};

export type RuleSettings = {
  baseUrl: string;
  policyName: string;
  githubMirrorUrl: string;
  publicLinksEnabled: boolean;
  tokenLinksEnabled: boolean;
  customIconPackUrls: string[];
  customIconPackNames: Record<string, string>;
};

export type RulesData = {
  version: 1;
  settings: RuleSettings;
  meta?: {
    d1Ready: boolean;
    adminPasswordConfigured: boolean;
    ruleTokenConfigured: boolean;
    sessionSecretConfigured: boolean;
    apiKeyConfigured: boolean;
  };
  categories: RuleCategory[];
  updatedAt: string;
  lastSyncedAt?: string;
};

export type BackupRuleSource = Partial<RuleSource> & Pick<RuleSource, 'sourceType'>;
export type BackupRuleCategory = Omit<RuleCategory, 'sources'> & { sources?: BackupRuleSource[] };
export type RulesBackupData = Omit<RulesData, 'categories' | 'meta' | 'lastSyncedAt'> & { categories: BackupRuleCategory[] };

export type ClientId =
  | 'general'
  | 'clash'
  | 'mihomo'
  | 'openclash'
  | 'clash-verge'
  | 'stash'
  | 'loon'
  | 'shadowrocket'
  | 'quantumult-x'
  | 'surge'
  | 'surge-mac'
  | 'egern'
  | 'surfboard'
  | 'sing-box'
  | 'v2ray'
  | 'url'
  | 'json';

export type ClientLink = {
  id: ClientId;
  name: string;
  icon: string;
  description: string;
  fileName: string;
  publicUrl: string;
  tokenUrl: string;
  recommendedUrl: string;
  supported: boolean;
};

export type ImportPreview = {
  rules: DomainRule[];
  duplicateValues: string[];
  invalidValues: string[];
  comments: string[];
};
