export type DomainRuleType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'IP-CIDR'
  | 'SRC-IP-CIDR'
  | 'IP-ASN'
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
  lastError?: string;
  syncIntervalMinutes: number;
  sourceType?: 'url' | 'geosite' | 'geoip';
  geositeName?: string;
  geoipName?: string;
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
};

export type RuleSettings = {
  baseUrl: string;
  policyName: string;
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
  };
  categories: RuleCategory[];
  updatedAt: string;
  lastSyncedAt?: string;
};

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
