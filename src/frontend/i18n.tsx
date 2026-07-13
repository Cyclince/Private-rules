import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type AppLocale = 'zh-CN' | 'zh-TW' | 'en';

let toTraditional: ((text: string) => string) | null = null;
let traditionalLoader: Promise<void> | null = null;

function ensureTraditionalConverter() {
  if (toTraditional) return Promise.resolve();
  traditionalLoader ??= import('opencc-js/cn2t').then(({ Converter }) => {
    toTraditional = Converter({ from: 'cn', to: 'tw' });
  });
  return traditionalLoader;
}

const ENGLISH_PHRASES: Array<[string, string]> = [
  ['选择从零构建或引用持续维护的上游规则', 'Build from scratch or use continuously maintained upstream rules'],
  ['统一管理基础配置、界面主题和数据备份', 'Manage site settings, appearance, and backups in one place'],
  ['配置订阅地址与生成规则时使用的默认策略组', 'Configure the subscription base URL and default policy group'],
  ['主题会同步调整卡片、表单和交互控件', 'The theme updates cards, forms, and controls together'],
  ['主题与语言会应用到整个管理界面', 'Theme and language apply to the entire admin UI'],
  ['保留 Qure Color，自定义图标包可随时修改名称和订阅地址', 'Keep Qure Color and edit custom icon pack names or URLs anytime'],
  ['备份覆盖分类、规则、上游来源、同步间隔和访问设置', 'Backups include rules, sources, sync intervals, and access settings'],
  ['选择由 Private Rules 导出的 JSON 文件', 'Select a JSON file exported by Private Rules'],
  ['生成可随时恢复的标准 JSON 快照', 'Create a restorable standard JSON snapshot'],
  ['这里只显示配置状态，不展示敏感值', 'Shows configuration status without exposing sensitive values'],
  ['保存站点地址、策略组和自定义图标包设置', 'Save the site URL, policy group, and custom icon packs'],
  ['从零维护规则，或聚合多个上游来源继续处理', 'Maintain your own rules or combine multiple upstream sources'],
  ['点击规则进入来源和同步管理', 'Open a rule to manage its sources and synchronization'],
  ['按来源与分类折叠，展开后查看具体规则', 'Grouped by source and category; expand to view rules'],
  ['默认收起，展开后可浏览完整图标包', 'Collapsed by default; expand to browse the complete icon pack'],
  ['首次创建会立即同步，之后按所选间隔自动更新', 'Syncs immediately after creation and then at the selected interval'],
  ['同一关键词会同时匹配域名规则与 IP 规则，可组合选择', 'One keyword searches both domain and IP rules for combined selection'],
  ['创建后可添加单条规则或批量导入', 'Add rules individually or import them in bulk after creation'],
  ['可进入规则详情继续编辑', 'Open rule details to continue editing'],
  ['来自远程订阅链接的只读镜像', 'Read-only mirror from remote subscription URLs'],
  ['来自 GeoSite 与 GeoIP 的只读镜像', 'Read-only mirror from GeoSite and GeoIP'],
  ['远程订阅不会与 Geo 数据配置相互覆盖', 'Remote subscriptions and Geo data remain isolated'],
  ['只影响当前规则的订阅链接', 'Only affects subscription links for this rule'],
  ['系统会根据当前访问策略自动选择可用地址', 'The available URL is selected from the current access policy'],
  ['选择规则与文件格式，每种格式对应一个通用地址', 'Choose a rule and file format; each format has one universal URL'],
  ['每条规则的访问方式都可以单独设置', 'Access can be configured independently for every rule'],
  ['选择文件后缀后复制地址，同系列客户端可以共用', 'Choose a file extension and copy one URL for compatible clients'],
  ['输入后台密码后继续管理私有规则', 'Enter the admin password to manage private rules'],
  ['立即检查远程订阅与 Geo 数据源，完成后会自动刷新规则统计', 'Check remote subscriptions and Geo sources now, then refresh statistics'],
  ['退出后需要重新输入后台密码才能继续管理规则', 'You will need the admin password to sign in again'],
  ['查看规则状态与分类变化', 'Review rule status and category changes'],
  ['按分类名称首字母排列', 'Sort alphabetically by category name'],
  ['规则数量从多到少排列', 'Sort by rule count'],
  ['按分类创建时间排列', 'Sort by creation time'],
  ['按最后修改时间排列', 'Sort by last modified time'],
  ['分类名称', 'Rule name'], ['分类说明', 'Description'], ['规则图标', 'Rule icon'],
  ['从零构建', 'Build from scratch'], ['引用上游', 'Use upstream'],
  ['订阅地址', 'Subscription URL'], ['Geo 数据库', 'Geo database'],
  ['上游订阅地址，一行一个', 'Upstream URLs, one per line'], ['自动同步间隔', 'Automatic sync interval'],
  ['搜索 GeoSite 与 GeoIP', 'Search GeoSite and GeoIP'], ['输入关键词，例如', 'Enter a keyword, such as'],
  ['正在查询 Geo 数据索引…', 'Searching the Geo index…'], ['没有找到匹配的 Geo 规则', 'No matching Geo rules found'],
  ['创建规则', 'Create rule'], ['新建规则', 'New rule'], ['关闭新建规则', 'Close new rule dialog'],
  ['规则汇总', 'Rule library'], ['规则分类', 'Rule categories'], ['所有规则', 'All rules'],
  ['自定义规则', 'Custom rules'], ['自定义维护', 'Custom maintenance'], ['上游订阅', 'Upstream subscriptions'],
  ['上游来源', 'Upstream sources'], ['只读镜像', 'Read-only mirror'], ['等待同步', 'Waiting to sync'],
  ['规则访问策略', 'Rule access policy'], ['私密访问（带密钥）', 'Private access (with token)'],
  ['公开访问', 'Public access'], ['禁止访问', 'Access disabled'], ['优先使用私密地址', 'Prefer private URL'],
  ['订阅中心', 'Subscription center'], ['选择规则', 'Choose a rule'], ['返回订阅中心', 'Back to subscriptions'],
  ['复制订阅链接', 'Copy subscription URL'], ['纯地址列表', 'Plain address list'], ['JSON 数据', 'JSON data'],
  ['概览', 'Overview'], ['规则', 'Rules'], ['订阅', 'Subscriptions'], ['设置', 'Settings'], ['关于', 'About'],
  ['规则控制台', 'Rule Console'], ['服务运行正常', 'Service online'], ['更多操作', 'More actions'],
  ['上游同步', 'Upstream sync'], ['最后同步', 'Last synced'], ['暂无同步记录', 'No sync history'],
  ['手动同步', 'Sync now'], ['同步全部上游规则', 'Sync all upstream rules'], ['开始同步', 'Start sync'],
  ['正在同步…', 'Syncing…'], ['上游规则同步完成', 'Upstream rules synced'],
  ['退出登录', 'Sign out'], ['退出当前账号', 'Sign out of this account'], ['确认退出', 'Sign out'], ['取消', 'Cancel'],
  ['外观', 'Appearance'], ['主题', 'Theme'], ['跟随系统', 'System'], ['浅色', 'Light'], ['深色', 'Dark'],
  ['语言', 'Language'], ['简体中文', 'Simplified Chinese'], ['繁体中文', 'Traditional Chinese'], ['英文', 'English'],
  ['基础设置', 'Basic settings'], ['站点基础 URL', 'Site base URL'], ['默认策略组名称', 'Default policy group'],
  ['分类图标包', 'Category icon packs'], ['预置', 'Built in'], ['图标包名称', 'Icon pack name'],
  ['的图标包名称', ' icon pack name'], ['的订阅地址', ' subscription URL'],
  ['添加图标包', 'Add icon pack'], ['移除自定义图标包', 'Remove custom icon pack'],
  ['数据备份', 'Data backup'], ['导出完整备份', 'Export full backup'], ['恢复备份', 'Restore backup'],
  ['文件格式', 'File format'], ['下载备份文件', 'Download backup'], ['选择文件', 'Choose file'],
  ['更换文件', 'Change file'], ['开始恢复', 'Restore now'], ['保存全部设置', 'Save all settings'],
  ['服务状态', 'Service status'], ['D1 数据库', 'D1 database'], ['后台密码', 'Admin password'], ['已连接', 'Connected'], ['未连接', 'Not connected'], ['已配置', 'Configured'], ['未配置', 'Not configured'],
  ['设置已保存', 'Settings saved'], ['图标包已添加', 'Icon pack added'], ['JSON 备份已导出', 'JSON backup exported'],
  ['备份已恢复', 'Backup restored'], ['无法导入备份', 'Unable to import backup'], ['备份结构不完整', 'Invalid backup structure'],
  ['登录后台', 'Admin sign in'], ['使用后台密码登录', 'Sign in with admin password'], ['进入后台', 'Continue'],
  ['正在登录…', 'Signing in…'], ['登录失败', 'Sign-in failed'],
  ['逐个添加', 'Add individually'], ['批量添加', 'Bulk add'], ['预览规则', 'Preview rules'],
  ['批量导入预览', 'Bulk import preview'], ['确认规则类型和重复项，导入后仍可逐条调整', 'Review types and duplicates before importing'],
  ['可导入', 'Ready'], ['重复', 'Duplicates'], ['无效', 'Invalid'], ['取消导入', 'Cancel import'], ['确认导入', 'Import'],
  ['添加规则', 'Add rule'], ['规则地址', 'Rule address'], ['规则类型', 'Rule type'], ['自动识别', 'Auto detect'],
  ['备注，可不填', 'Note (optional)'], ['搜索规则或来源', 'Search rules or sources'], ['复制全部', 'Copy all'],
  ['编辑规则', 'Edit rule'], ['删除规则', 'Delete rule'], ['返回规则汇总', 'Back to rule library'],
  ['分类排序', 'Category sorting'], ['名称', 'Name'], ['规则数量', 'Rule count'], ['创建时间', 'Created'], ['修改时间', 'Modified'],
  ['从小到大', 'Ascending'], ['从大到小', 'Descending'], ['已启用', 'Enabled'], ['已停用', 'Disabled'],
  ['免责声明', 'Disclaimer'], ['项目信息', 'Project information'], ['作者频道', 'Author channel'],
  ['暂无上游', 'No upstream sources'], ['暂无自定义规则', 'No custom rules'], ['没有匹配的图标', 'No matching icons'],
  ['例如', 'Example'], ['可留空', 'Optional'], ['一行一条，预览确认后再导入', 'One rule per line; preview before importing'],
  ['条启用规则', ' enabled rules'], ['条规则', ' rules'], ['个上游', ' upstream sources'], ['个 GeoSite', ' GeoSite'], ['个 GeoIP', ' GeoIP'],
  ['已同步', 'Synced'], ['同步于', 'Synced'], ['私密', 'Private'], ['公开', 'Public'], ['已禁用', 'Disabled'],
  ['条', 'rules'],
];

const orderedEnglishPhrases = [...ENGLISH_PHRASES].sort((a, b) => b[0].length - a[0].length);
type TrackedText = { source: string; rendered: string };
const trackedText = new WeakMap<Text, TrackedText>();
const trackedAttributes = new WeakMap<Element, Map<string, TrackedText>>();

function english(text: string) {
  let output = text;
  for (const [source, target] of orderedEnglishPhrases) output = output.replaceAll(source, target);
  output = output
    .replace(/(\d+)\s*条/g, '$1 rules')
    .replace(/(\d+)\s*个/g, '$1 ')
    .replace(/每\s*(\d+)\s*分钟/g, 'Every $1 minutes')
    .replace(/每\s*(\d+)\s*小时/g, 'Every $1 hours');
  return output;
}

export function translateUiText(text: string, locale: AppLocale) {
  if (locale === 'zh-CN') return text;
  if (locale === 'zh-TW') return toTraditional?.(text) ?? text;
  return english(text);
}

function translateTextNode(node: Text, locale: AppLocale) {
  const current = node.nodeValue ?? '';
  const previous = trackedText.get(node);
  const source = previous && current === previous.rendered ? previous.source : current;
  const rendered = translateUiText(source, locale);
  trackedText.set(node, { source, rendered });
  if (current !== rendered) node.nodeValue = rendered;
}

function translateAttribute(element: Element, name: string, locale: AppLocale) {
  const current = element.getAttribute(name);
  if (current == null) return;
  const attributes = trackedAttributes.get(element) ?? new Map<string, TrackedText>();
  const previous = attributes.get(name);
  const source = previous && current === previous.rendered ? previous.source : current;
  const rendered = translateUiText(source, locale);
  attributes.set(name, { source, rendered });
  trackedAttributes.set(element, attributes);
  if (current !== rendered) element.setAttribute(name, rendered);
}

function localizeNode(root: Node, locale: AppLocale) {
  if (root instanceof Text) {
    translateTextNode(root, locale);
    return;
  }
  if (!(root instanceof Element) || root.matches('script, style, code, pre, [data-no-translate]')) return;
  for (const name of ['placeholder', 'aria-label', 'title']) translateAttribute(root, name, locale);
  for (const child of root.childNodes) localizeNode(child, locale);
}

function localizeDocument(locale: AppLocale) {
  if (document.body) localizeNode(document.body, locale);
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
}

function runUiTransition(kind: 'theme' | 'locale', update: () => void) {
  const root = document.documentElement;
  root.classList.add(`${kind}-transitioning`, 'ui-transitioning');
  window.setTimeout(() => root.classList.remove(`${kind}-transitioning`, 'ui-transitioning'), 1050);
  const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } };
  if (transitionDocument.startViewTransition) transitionDocument.startViewTransition(update);
  else update();
}

type LocaleContextValue = { locale: AppLocale; setLocale: (locale: AppLocale) => void };
const LocaleContext = createContext<LocaleContextValue>({ locale: 'zh-CN', setLocale: () => undefined });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    const saved = localStorage.getItem('private-rules-locale');
    return saved === 'zh-TW' || saved === 'en' ? saved : 'zh-CN';
  });

  useLayoutEffect(() => {
    localStorage.setItem('private-rules-locale', locale);
    if (locale === 'zh-TW') void ensureTraditionalConverter().then(() => localizeDocument(locale));
    else localizeDocument(locale);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target as Text, locale);
        else for (const node of record.addedNodes) localizeNode(node, locale);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale: (next) => {
    if (next === locale) return;
    const commit = () => runUiTransition('locale', () => {
      flushSync(() => setLocaleState(next));
      localizeDocument(next);
    });
    if (next === 'zh-TW') void ensureTraditionalConverter().then(commit);
    else commit();
  } }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function transitionTheme(update: () => void) {
  runUiTransition('theme', update);
}
