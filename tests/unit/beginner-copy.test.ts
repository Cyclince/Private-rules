import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zhCN } from '../../src/web/i18n/zh-CN';

const NORMAL_FILES = [
  'src/web/routes/index.tsx',
  'src/web/routes/rules.index.tsx',
  'src/web/routes/rules.$id.tsx',
  'src/web/components/rulesets/RuleCategoryDialog.tsx',
  'src/web/components/rulesets/RuleFormDialog.tsx',
  'src/web/components/rulesets/SourceFormDialog.tsx',
  'src/web/components/rulesets/rule-library-helpers.ts',
  'src/domain/rules/friendly.ts',
  'src/web/routes/subscriptions.index.tsx',
  'src/web/routes/subscriptions.$id.tsx',
  'src/web/components/subscriptions/subscription-helpers.ts',
  'src/web/components/subscriptions/SubscriptionExample.tsx',
  'src/web/routes/templates.index.tsx',
  'src/web/routes/templates.new.tsx',
  'src/web/routes/templates.$id.tsx',
  'src/web/components/templates/QuickCreateWizard.tsx',
  'src/web/components/templates/WizardDoneLinks.tsx',
  'src/web/components/templates/TemplateSimpleRoutingTab.tsx',
  'src/web/components/templates/TemplateSimpleNodesTab.tsx',
  'src/web/components/templates/TemplateSimpleOutputTab.tsx',
  'src/web/components/templates/AddClientDialog.tsx',
];
const NORMAL_PREFIXES = [
  'dashboard.',
  'common.',
  'error.',
  'rules.',
  'rulesets.',
  'sources.',
  'ruleLibrary.',
  'ruleDialog.',
  'ruleDetail.',
  'subscriptions.',
  'links.',
  'templates.',
  'wizard.',
  'templateDetail.',
  'import.',
  'ruleType.',
  'ruleTypeDesc.',
  'ruleInline.',
  'cards.',
  'catalog.',
];

// Explicit exceptions for advanced editing and original syntax / type-guide examples.
// Scene-library files and advanced-only components are deliberately not in NORMAL_FILES.
const ALLOWED_TECHNICAL_PREFIXES = [
  'cards.', // Scene-library editor vocabulary.
  'catalog.', // Community scene/rule library examples.
  'templates.editor',
  'templates.probe',
  'templates.version',
  'templates.rebase',
  'templates.outputFull',
  'templates.outputMinimal',
  'templateDetail.advanced',
  'import.textarea',
  'ruleTypeDesc.',
];
const FORBIDDEN = /槽位|组件|发布|full|minimal|Fork|策略组|overlay|DOMAIN-|IP-CIDR|no-resolve/i;

function allowed(key: string) {
  return ALLOWED_TECHNICAL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function violations(entries: Array<[string, string]>) {
  return entries.filter(([key, value]) => !allowed(key) && FORBIDDEN.test(value));
}

async function usedKeys() {
  const keys = new Set<string>();
  for (const path of NORMAL_FILES) {
    const source = await readFile(resolve(path), 'utf8');
    // Include labelKey/titleKey metadata as well as direct t() calls.
    for (const match of source.matchAll(/['"]([\w.-]+)['"]/g)) {
      if (NORMAL_PREFIXES.some((prefix) => match[1].startsWith(prefix))) keys.add(match[1]);
    }
    // Expand dynamic i18n key families such as `wizard.scenario.${id}`.
    for (const match of source.matchAll(/`([\w.-]+)\$\{/g)) {
      if (NORMAL_PREFIXES.some((prefix) => match[1].startsWith(prefix))) {
        for (const key of Object.keys(zhCN)) if (key.startsWith(match[1])) keys.add(key);
      }
    }
  }
  // API errors may be translated dynamically on every ordinary page.
  for (const key of Object.keys(zhCN)) if (key.startsWith('error.')) keys.add(key);
  return [...keys];
}

describe('F7 ordinary-page Chinese copy', () => {
  it('scans keys used by rules, subscriptions, template list/wizard and ordinary detail tabs', async () => {
    const keys = await usedKeys();
    expect(keys.length).toBeGreaterThan(200);
    const dictionary: Record<string, string> = zhCN;
    expect(keys.filter((key) => !(key in dictionary))).toEqual([]);
    expect(violations(keys.map((key) => [key, dictionary[key]]))).toEqual([]);
  });

  it('rejects every forbidden term instead of silently broadening the whitelist', () => {
    for (const term of [
      '槽位',
      '组件',
      '发布',
      'full',
      'minimal',
      'Fork',
      '策略组',
      'overlay',
      'DOMAIN-SUFFIX',
      'IP-CIDR',
      'no-resolve',
    ]) {
      expect(violations([['wizard.step1Desc', term]])).toHaveLength(1);
    }
    expect(violations([['templateDetail.outputDesc', '发布到策略组']])).toHaveLength(1);
    expect(violations([['templates.deleteConfirmBody', '发布配置']])).toHaveLength(1);
    expect(
      violations([
        ['templates.editorSlotsTitle', '节点槽位'],
        ['ruleTypeDesc.IP-CIDR', 'IP-CIDR 原文'],
      ]),
    ).toEqual([]);
  });
});
