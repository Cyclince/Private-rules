import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zhCN } from '../../src/web/i18n/zh-CN';
import { zhCNApps } from '../../src/web/i18n/zh-CN.apps';

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
  'src/web/components/templates/wizard/WizardProgress.tsx',
  'src/web/components/templates/wizard/WizardStepApps.tsx',
  'src/web/components/templates/wizard/WizardStepSubscriptions.tsx',
  'src/web/components/templates/wizard/WizardStepComplexity.tsx',
  'src/web/components/templates/wizard/WizardStepPolicyGroups.tsx',
  'src/web/components/templates/wizard/WizardStepMyRules.tsx',
  'src/web/components/templates/wizard/WizardStepNodePools.tsx',
  'src/web/components/templates/wizard/WizardStepModules.tsx',
  'src/web/components/templates/wizard/WizardStepSummary.tsx',
  'src/web/components/templates/TemplateSimpleRoutingTab.tsx',
  'src/web/components/templates/TemplateSimpleNodesTab.tsx',
  'src/web/components/templates/TemplateSimpleOutputTab.tsx',
  'src/web/components/templates/AddClientDialog.tsx',
  'src/web/routes/templates.groups.tsx',
  'src/web/components/apps/AppPicker.tsx',
  'src/web/components/apps/AppIcon.tsx',
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
  'taxonomy.',
  'apps.',
];

// Explicit exceptions for advanced editing and original syntax / type-guide examples.
// The policy-group editor vocabulary stays whitelisted; advanced-only components are deliberately
// not in NORMAL_FILES. "策略组" itself is a user-facing term (design revision r2 §4.1).
const ALLOWED_TECHNICAL_PREFIXES = [
  'subscriptions.examplePolicyHint', // Localized guidance within the configuration example, not ordinary copy.
  // "其他格式（高级）" fold (design R2): group/format vocabulary lives behind one collapsed section.
  'subscriptions.group',
  'subscriptions.format',
  'subscriptions.otherFormatsTitle', // The fold's own label is the required "其他格式（高级）" wording.
  'cards.', // Policy-group editor vocabulary (matcher kinds, rule syntax placeholders).
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
// "策略组" is intentionally allowed: it is the user-visible name of a policy group (r2 §4.1).
const FORBIDDEN =
  /槽位|组件|发布|full|minimal|Fork|overlay|DOMAIN-|IP-CIDR|no-resolve|内核|语法|格式|YAML|LIST|JSON/i;

function allowed(key: string) {
  return ALLOWED_TECHNICAL_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function violations(entries: Array<[string, string]>) {
  return entries.filter(([key, value]) => !allowed(key) && FORBIDDEN.test(value));
}

const dictionary: Record<string, string> = { ...zhCN, ...zhCNApps };

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
        for (const key of Object.keys(dictionary)) if (key.startsWith(match[1])) keys.add(key);
      }
    }
  }
  // API errors may be translated dynamically on every ordinary page.
  for (const key of Object.keys(dictionary)) if (key.startsWith('error.')) keys.add(key);
  // Software-catalog guidance is rendered through dynamic keys (`app.howToKey`), so scan the whole family.
  for (const key of Object.keys(dictionary)) if (key.startsWith('apps.')) keys.add(key);
  return [...keys];
}

describe('F7 ordinary-page Chinese copy', () => {
  it('scans keys used by rules, subscriptions, template list/wizard and ordinary detail tabs', async () => {
    const keys = await usedKeys();
    expect(keys.length).toBeGreaterThan(200);
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
      'overlay',
      'DOMAIN-SUFFIX',
      'IP-CIDR',
      'no-resolve',
      '内核',
      '语法',
      '格式',
      'YAML',
      'LIST',
      'JSON',
    ]) {
      expect(violations([['wizard.step1Desc', term]])).toHaveLength(1);
    }
    expect(violations([['templateDetail.outputDesc', '发布到策略组']])).toHaveLength(1);
    expect(violations([['subscriptions.exampleTitle', '策略组']])).toEqual([]);
    expect(violations([['cards.subtitle', '策略组 = 一类网站走哪条线路']])).toEqual([]);
    expect(violations([['subscriptions.examplePolicyHint', '把 PROXY 换成策略组名称']])).toEqual([]);
    // Only the advanced "other formats" fold may use format vocabulary.
    expect(violations([['subscriptions.format.yaml-classical.desc', '原生 YAML 规则']])).toEqual([]);
    expect(violations([['subscriptions.appLinkHint', '复制这条地址，粘贴到软件里即可']])).toEqual([]);
    expect(violations([['subscriptions.appLinkHint', '复制这条 YAML 地址']])).toHaveLength(1);
    expect(violations([['templates.deleteConfirmBody', '发布配置']])).toHaveLength(1);
    expect(
      violations([
        ['templates.editorSlotsTitle', '节点槽位'],
        ['ruleTypeDesc.IP-CIDR', 'IP-CIDR 原文'],
      ]),
    ).toEqual([]);
  });
});
