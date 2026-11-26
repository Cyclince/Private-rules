import { createRepositories } from '../../data/repositories';
import { id } from '../../domain/rules/slug';
import { validateRemoteSourceUrl } from '../../infrastructure/http/fetch';
import { AppError } from '../../shared/errors';
import type { Env } from '../../types';
import type { RuleOptimizationMode, RuleSource } from '../../types/domain-rules';
import { normalizeUserAgent, now, sourceNameFromUrl } from '../rulesets';
import { previewSourceRules, syncSourceById } from '../sync';

export type SourceInput = {
  name?: string;
  sourceType: 'url' | 'geosite' | 'geoip';
  url?: string;
  geositeName?: string;
  geoipName?: string;
  userAgent?: string;
  syncIntervalMinutes?: number;
  enabled?: boolean;
  ruleOptimization?: RuleOptimizationMode;
};

const GEO_NAME = /^[a-z0-9_!@.-]{1,120}$/i;
const SYNC_INTERVALS = new Set([15, 30, 60, 360, 720, 1440]);

type NormalizedSourceInput = {
  sourceType: 'url' | 'geosite' | 'geoip';
  url: string;
  geositeName: string | null;
  geoipName: string | null;
  name: string;
  userAgent: string;
  ruleOptimization: RuleOptimizationMode;
  syncIntervalMinutes: number;
  enabled: boolean;
};

function normalizeInput(input: SourceInput): NormalizedSourceInput {
  const sourceType = input.sourceType;
  const syncIntervalMinutes = input.syncIntervalMinutes ?? 60;
  if (!SYNC_INTERVALS.has(syncIntervalMinutes)) throw new AppError('VALIDATION_FAILED', '同步周期无效。');
  const enabled = input.enabled !== false;
  if (sourceType === 'url') {
    const url = validateRemoteSourceUrl(input.url ?? '');
    return {
      sourceType,
      url,
      geositeName: null,
      geoipName: null,
      name: input.name?.trim().slice(0, 120) || sourceNameFromUrl(url, 'Remote'),
      userAgent: normalizeUserAgent(input.userAgent),
      ruleOptimization:
        input.ruleOptimization === 'conservative' || input.ruleOptimization === 'aggressive'
          ? input.ruleOptimization
          : 'none',
      syncIntervalMinutes,
      enabled,
    };
  }
  const geoName = (sourceType === 'geosite' ? input.geositeName : input.geoipName)?.trim().toLowerCase() ?? '';
  if (!GEO_NAME.test(geoName)) {
    throw new AppError('VALIDATION_FAILED', `${sourceType === 'geosite' ? 'GeoSite' : 'GeoIP'} 名称无效。`);
  }
  const url =
    sourceType === 'geosite'
      ? `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(geoName)}`
      : `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(geoName)}.txt`;
  return {
    sourceType,
    url,
    geositeName: sourceType === 'geosite' ? geoName : null,
    geoipName: sourceType === 'geoip' ? geoName : null,
    name: input.name?.trim().slice(0, 120) || `${sourceType === 'geosite' ? 'GeoSite' : 'GeoIP'} · ${geoName}`,
    userAgent: normalizeUserAgent(input.userAgent),
    ruleOptimization: 'none',
    syncIntervalMinutes,
    enabled,
  };
}

export async function listSources(env: Env, categoryId: string): Promise<RuleSource[]> {
  return createRepositories(env.DB).sources.listByCategory(categoryId);
}

export async function getSource(env: Env, sourceId: string, categoryId?: string): Promise<RuleSource | null> {
  return createRepositories(env.DB).sources.findById(sourceId, categoryId);
}

export async function previewSource(env: Env, input: SourceInput) {
  return previewSourceRules(env, normalizeInput(input));
}

export async function createSource(env: Env, categoryId: string, input: SourceInput): Promise<RuleSource | null> {
  const repos = createRepositories(env.DB);
  const category = await repos.rulesets.findById(categoryId);
  if (!category) throw new AppError('RULESET_NOT_FOUND', '分类不存在。');
  const source = normalizeInput(input);
  if (await repos.sources.hasDuplicateUrl(categoryId, source.url)) {
    throw new AppError('CONFLICT', '该来源已存在。');
  }
  const sourceId = id('src');
  const timestamp = now();
  await repos.sources.create({
    id: sourceId,
    categoryId,
    name: source.name,
    url: source.url,
    enabled: source.enabled ? 1 : 0,
    lastStatus: 'pending',
    syncIntervalMinutes: source.syncIntervalMinutes,
    userAgent: source.userAgent,
    sourceType: source.sourceType,
    geositeName: source.geositeName,
    geoipName: source.geoipName,
    ruleOptimization: source.ruleOptimization,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return repos.sources.findById(sourceId);
}

export async function updateSource(env: Env, sourceId: string, input: SourceInput): Promise<RuleSource | null> {
  const repos = createRepositories(env.DB);
  const current = await repos.sources.findById(sourceId);
  if (!current) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  const source = normalizeInput(input);
  if (await repos.sources.hasDuplicateUrl(current.categoryId, source.url, sourceId)) {
    throw new AppError('CONFLICT', '该来源已存在。');
  }
  await repos.sources.update(sourceId, {
    name: source.name,
    url: source.url,
    enabled: source.enabled ? 1 : 0,
    syncIntervalMinutes: source.syncIntervalMinutes,
    userAgent: source.userAgent,
    sourceType: source.sourceType,
    geositeName: source.geositeName,
    geoipName: source.geoipName,
    ruleOptimization: source.ruleOptimization,
    updatedAt: now(),
  });
  return repos.sources.findById(sourceId);
}

export async function toggleSource(env: Env, sourceId: string, enabled: boolean): Promise<RuleSource | null> {
  const repos = createRepositories(env.DB);
  const updated = await repos.sources.toggle(sourceId, enabled, now());
  if (!updated) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  return repos.sources.findById(sourceId);
}

export async function deleteSource(env: Env, sourceId: string): Promise<RuleSource> {
  const repos = createRepositories(env.DB);
  const source = await repos.sources.findById(sourceId);
  if (!source) throw new AppError('SOURCE_NOT_FOUND', '来源不存在。');
  if (await repos.sources.hasActiveLease(sourceId, now())) {
    throw new AppError('SYNC_IN_PROGRESS', '来源正在同步，暂时不能删除。');
  }
  await repos.sources.deleteWithRules(sourceId, source.categoryId, now());
  return source;
}

export { syncSourceById, validateRemoteSourceUrl };
