import type { ClientId, ClientLink, RuleCategory, RulesData } from '../types/domain-rules';
import { fileNameForClient } from './formatters';

const clients: Array<Omit<ClientLink, 'fileName' | 'publicUrl' | 'tokenUrl' | 'recommendedUrl' | 'supported'>> = [
  { id: 'general', name: 'General', icon: 'GEN', description: '通用 LIST，适合多数客户端手动导入' },
  { id: 'clash', name: 'Clash', icon: 'CLA', description: 'YAML Rule Provider' },
  { id: 'mihomo', name: 'Mihomo', icon: 'MI', description: 'YAML Rule Provider' },
  { id: 'openclash', name: 'OpenClash', icon: 'OC', description: 'YAML Rule Provider' },
  { id: 'clash-verge', name: 'Clash Verge', icon: 'CV', description: 'YAML Rule Provider' },
  { id: 'stash', name: 'Stash', icon: 'ST', description: 'YAML Rule Provider' },
  { id: 'loon', name: 'Loon', icon: 'LO', description: 'LIST 规则' },
  { id: 'shadowrocket', name: 'Shadowrocket', icon: 'SR', description: 'LIST 规则' },
  { id: 'quantumult-x', name: 'Quantumult X', icon: 'QX', description: 'QX HOST / IP 兼容格式' },
  { id: 'surge', name: 'Surge', icon: 'SU', description: 'Surge LIST 规则' },
  { id: 'surge-mac', name: 'Surge Mac', icon: 'SM', description: 'Surge for Mac LIST 规则' },
  { id: 'egern', name: 'Egern', icon: 'EG', description: 'LIST 规则' },
  { id: 'surfboard', name: 'Surfboard', icon: 'SB', description: 'LIST 规则' },
  { id: 'sing-box', name: 'sing-box', icon: 'SBX', description: '通用规则列表' },
  { id: 'v2ray', name: 'V2Ray', icon: 'V2', description: '通用规则列表' },
  { id: 'url', name: 'URL', icon: 'URL', description: '纯域名/IP 列表' },
  { id: 'json', name: 'JSON', icon: 'JS', description: '结构化备份或二次处理' },
];

function siteBase(requestUrl: string, data: RulesData) {
  return data.settings.baseUrl.trim().replace(/\/+$/, '') || new URL(requestUrl).origin;
}

export function linksForCategory(category: RuleCategory, data: RulesData, requestUrl: string, ruleToken?: string): ClientLink[] {
  const base = siteBase(requestUrl, data);
  return clients.map((client) => {
    const fileName = fileNameForClient(category, client.id as ClientId);
    const publicUrl = `${base}/rules/${fileName}`;
    const tokenUrl = ruleToken ? `${base}/sub/${encodeURIComponent(ruleToken)}/${fileName}` : '';
    const tokenEnabled = category.tokenLinksEnabled !== false;
    const publicEnabled = !tokenEnabled && category.publicLinksEnabled !== false;
    const recommendedUrl = tokenEnabled && tokenUrl
      ? tokenUrl
      : publicEnabled
        ? publicUrl
        : '';
    return {
      ...client,
      fileName,
      publicUrl,
      tokenUrl,
      recommendedUrl,
      supported: true,
    };
  });
}

export function linksByCategory(data: RulesData, requestUrl: string, ruleToken?: string) {
  return Object.fromEntries(data.categories.map((category) => [category.id, linksForCategory(category, data, requestUrl, ruleToken)]));
}
