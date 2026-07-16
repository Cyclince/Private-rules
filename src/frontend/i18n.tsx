import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

export type AppLocale = 'system' | 'zh-CN' | 'zh-TW' | 'en';
type ResolvedLocale = Exclude<AppLocale, 'system'>;

export function resolveSystemLocale(languages: readonly string[]): ResolvedLocale {
  const normalized = (languages[0] ?? '').toLowerCase();
  if (normalized.startsWith('zh')) return /(?:hant|tw|hk|mo)/.test(normalized) ? 'zh-TW' : 'zh-CN';
  if (normalized.startsWith('en')) return 'en';
  return 'en';
}

function detectSystemLocale(): ResolvedLocale {
  return resolveSystemLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

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
  ['操作简单、维护方便的私有自托管规则控制台，支持 Cloudflare Workers 和 Docker Compose 部署', 'A simple, easy-to-maintain private self-hosted rules console for Cloudflare Workers and Docker Compose'],
  ['可使用 Cloudflare Workers 与 D1，也可通过 Docker Compose 与 SQLite 自托管', 'Run on Cloudflare Workers with D1, or self-host with Docker Compose and SQLite'],
  ['按分类维护域名、关键词与 IP 规则，并按需组合上游来源', 'Organize domains, keywords, and IP rules by category, with optional upstream sources'],
  ['统一生成 YAML、LIST、JSON 与纯地址文件，覆盖常用代理客户端', 'Generate YAML, LIST, JSON, and plain address files for popular proxy clients'],
  ['规则保存在自己的 D1 或 SQLite 数据库中，并支持 JSON 完整备份', 'Keep rules in your own D1 or SQLite database with full JSON backups'],
  ['本项目仅供学习与技术测试使用，请遵守当地法律法规。使用者对配置、转发内容与访问行为承担全部责任，开发者不对任何直接或间接损失负责。', 'This project is intended for learning and technical testing only. Follow local laws and regulations. You are responsible for your configuration, forwarded content, and access activity; the developer is not liable for direct or indirect losses.'],
  ['开源代码、更新记录与作者频道', 'Source code, release history, and author channel'],
  ['关于 Private Rules', 'About Private Rules'], ['集中维护', 'Centralized management'], ['多端订阅', 'Multi-client subscriptions'], ['灵活部署', 'Flexible deployment'],
  ['GitHub 开源仓库', 'GitHub repository'], ['作者 Telegram 频道', 'Author Telegram channel'],
  ['适用于 Mihomo、Clash、OpenClash 与 Stash', 'For Mihomo, Clash, OpenClash, and Stash'],
  ['适用于 Loon、Surge、Shadowrocket 与 Egern', 'For Loon, Surge, Shadowrocket, and Egern'],
  ['仅保留域名与 IP，方便脚本或其他工具继续处理', 'Keep only domains and IPs for scripts and other tools'],
  ['保留结构化规则数据，适合二次开发和自动化', 'Keep structured rule data for integrations and automation'],
  ['当前未开放订阅访问', 'Subscription access is disabled'], ['当前使用公开地址', 'Using the public URL'],
  ['此规则当前未开放可用的订阅链接', 'No subscription URL is currently available for this rule'],
  ['规则访问策略已更新', 'Rule access policy updated'], ['订阅链接已复制', 'Subscription URL copied'],
  ['YAML 规则集', 'YAML rule set'], ['LIST 规则集', 'LIST rule set'],
  ['匹配该域名及其子域名', 'Match the domain and its subdomains'], ['及其子域名', 'and its subdomains'],
  ['按规则分类创建时间排列', 'Sort by rule category creation time'], ['按分类规则数量排列', 'Sort by rule count per category'],
  ['Private Rules 规则守护者', 'Private Rules rule guardian'],
  ['正在加载图标包', 'Loading icon pack'], ['图标包加载失败', 'Failed to load icon pack'],
  ['已选择图标，可展开继续更换', 'Icon selected; expand to choose another'], ['搜索图标，例如 Emby、AI', 'Search icons, such as Emby or AI'],
  ['当前没有可用订阅链接，请检查访问策略和 RULE_TOKEN', 'No subscription URL is available. Check the access policy and RULE_TOKEN'],
  ['链接已复制', 'Link copied'], ['复制失败，请手动复制', 'Copy failed; please copy manually'], ['预览', 'Preview'],
  ['规则已更新', 'Rule updated'], ['所选规则已启用', 'Selected rules enabled'], ['所选规则已禁用', 'Selected rules disabled'],
  ['规则已创建并完成首次上游同步', 'Rule created and initial upstream sync completed'], ['规则已添加', 'Rule added'],
  ['批量导入完成', 'Bulk import completed'], ['分类配置已更新', 'Rule configuration updated'], ['分类已删除', 'Rule deleted'],
  ['该分类的上游规则已同步', 'Upstream rules for this category synced'], ['关闭编辑规则', 'Close rule editor'],
  ['保存规则信息不会添加上游来源', 'Saving rule information will not add upstream sources'], ['保存后可随时同步最新规则', 'Save now and sync the latest rules anytime'],
  ['等待首次同步', 'Waiting for initial sync'], ['关闭导入预览', 'Close import preview'], ['关闭单条编辑', 'Close rule editor'],
  ['聚合分类 · 推荐', 'Collection · Recommended'], ['域名规则', 'Domain rules'], ['远程订阅', 'Remote subscriptions'],
  ['Geo 数据', 'Geo data'], ['混合来源', 'Mixed sources'], ['我的图标包', 'My icon packs'],
  ['自定义图标包', 'Custom icon pack'], ['已复制', 'Copied'], ['已填写', 'entered'], ['已选择', 'selected'],
  ['个上游来源', ' upstream sources'], ['个 GeoSite 与', ' GeoSite and'],
  ['修改为', 'Change to '], ['的备注', ' note'], ['相关服务和域名规则', ' related services and domain rules'],
  ['还没有规则分类', 'No rule categories yet'], ['前往规则页创建第一个分类', 'Go to Rules to create the first category'],
  ['选择你的代理软件', 'Choose your proxy client'],
  ['复制适合该客户端的订阅链接，私密访问会自动携带密钥', 'Copy the subscription URL for this client; private URLs include the token automatically'],
  ['即将支持，当前复制通用链接', 'Coming soon; copy the general URL for now'], ['关闭', 'Close'],
  ['来源类型保持独立，远程订阅不会与 Geo 数据配置相互覆盖', 'Source types remain separate; remote subscriptions and Geo data never overwrite each other'],
  ['仅维护自定义规则，不显示远程订阅或 Geo 数据设置', 'Manage custom rules only, without remote subscription or Geo data settings'],
  ['远程订阅地址，一行一个', 'Remote subscription URLs, one per line'],
  ['继续使用订阅链接作为上游，不会切换为 Geo 数据', 'Continue using subscription URLs as upstream sources without switching to Geo data'],
  ['更换或追加 GeoSite 与 GeoIP', 'Replace or add GeoSite and GeoIP sources'],
  ['同时搜索域名与 IP 规则，不会混入远程订阅链接', 'Search domain and IP rules without mixing in remote subscription URLs'],
  ['保存规则配置', 'Save rule configuration'], ['没有可导入的规则', 'No rules can be imported'],
  ['请返回修改批量内容', 'Go back and revise the bulk input'], ['编辑', 'Edit'], ['备注', 'Note'],
  ['只影响', 'Only affects'], [' 的订阅链接', "'s subscription links"],
  ['无法加载规则数据，请检查数据库连接', 'Unable to load rule data; check the database connection'],
  ['Geo 数据索引加载失败', 'Failed to load the Geo data index'], ['备份导出失败', 'Backup export failed'],
  ['API Key 生成失败', 'API Key generation failed'], ['浏览器拒绝了剪贴板访问，请手动复制', 'Clipboard access was denied; please copy manually'],
  ['加载失败', 'Loading failed'], ['操作失败', 'Operation failed'], ['登录中...', 'Signing in...'],
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
  ['允许其他项目通过 Bearer API Key 读取和维护规则数据库', 'Allow other projects to read and maintain the rules database with a Bearer API Key'],
  ['为了安全，页面刷新后将不再显示明文', 'For security, the plaintext key disappears after the page is refreshed'],
  ['可访问 `/api/categories`、`/api/data`、规则维护与同步接口', 'Access `/api/categories`, `/api/data`, rule maintenance, and sync endpoints'],
  ['请立即复制 API Key', 'Copy the API Key now'], ['API 地址', 'API URL'], ['当前状态', 'Status'],
  ['尚未创建', 'Not created'], ['已创建', 'Created'], ['生成 API Key', 'Generate API Key'],
  ['重新生成', 'Regenerate'], ['删除 API Key', 'Delete API Key'], ['处理中…', 'Working…'],
  ['API Key 已重新生成', 'API Key regenerated'], ['API Key 已生成', 'API Key generated'],
  ['API Key 已删除', 'API Key deleted'], ['API Key 已复制', 'API Key copied'],
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
  ['输入域名、关键词、IP、类型、来源或分类即可模糊匹配', 'Fuzzy-search by domain, keyword, IP, type, source, or category'],
  ['搜索域名、关键词、IP…', 'Search domains, keywords, or IPs…'],
  ['默认私密访问，创建后可在订阅页修改', 'Private by default; change it anytime in Subscriptions'],
  ['默认公开访问', 'Public by default'],
  ['仅限英文字母、数字、空格和英文标点', 'Use ASCII letters, numbers, spaces, and punctuation only'],
  ['分类名称仅支持英文字母、数字、空格和英文标点，且至少包含一个字母或数字。', 'Use only ASCII letters, numbers, spaces, and punctuation, including at least one letter or number.'],
  ['保存后订阅链接会立即使用新名称', 'Subscription URLs update immediately after saving'],
  ['没有匹配规则', 'No matching rules'],
  ['完整域名', 'Exact domain'], ['域名后缀', 'Domain suffix'], ['关键词', 'Keyword'],
  ['IP / IP 段', 'IP / CIDR'], ['源 IP 段', 'Source IP / CIDR'], ['目标端口', 'Destination port'], ['站点集合', 'Site collection'],
  ['国家 / 地区 IP', 'Country / region IP'], ['单个 IP', 'Single IP'], ['地址规则', 'Address rule'],
  ['系统根据输入内容自动判断', 'Detect from the entered value'],
  ['只匹配完整域名', 'Match the exact domain only'], ['匹配该域名及其子域名', 'Match the domain and its subdomains'],
  ['匹配包含该关键词的域名', 'Match domains containing the keyword'], ['匹配 IP 地址或网段', 'Match an IP address or CIDR'],
  ['匹配来源 IP 网段', 'Match a source IP CIDR'], ['匹配网络自治系统编号', 'Match an autonomous system number'], ['匹配目标端口或端口范围', 'Match a destination port or port range'],
  ['匹配客户端内置的站点集合', 'Match a site collection built into the client'], ['匹配客户端内置的国家或地区 IP', 'Match country or region IP data built into the client'],
  ['同步上游', 'Sync upstream'], ['每天自动更新，镜像规则保持只读', 'Updates daily; mirrored rules remain read-only'],
  ['自动更新，镜像规则保持只读', ' automatic updates; mirrored rules remain read-only'],
  ['每小时', 'Hourly'], ['每天', 'Daily'],
  ['上游镜像规则', 'Upstream mirrored rules'], ['展开查看', 'Expand'], ['来自', 'From'], ['只读', 'Read-only'],
  ['自定义规则不会被上游同步覆盖', 'Custom rules are never overwritten by upstream sync'],
  ['仅这里的规则可以禁用或删除', 'Only rules listed here can be disabled or deleted'],
  ['上游规则已在来源区域收起展示', 'Upstream rules are collapsed in the source section'],
  ['维护这个规则下的内容', 'Manage the contents of this rule set'],
  ['例如：ChatGPT 官网', 'Example: ChatGPT website'], ['例如：chatgpt.com、+.apple.com、127.0.0.0/8', 'Example: chatgpt.com, +.apple.com, 127.0.0.0/8'],
  ['分类名称', 'Rule name'], ['分类说明', 'Description'], ['规则图标', 'Rule icon'],
  ['从零构建', 'Build from scratch'], ['引用上游', 'Use upstream'],
  ['订阅地址', 'Subscription URL'], ['Geo 数据库', 'Geo database'],
  ['上游订阅地址，一行一个', 'Upstream URLs, one per line'], ['自动同步间隔', 'Automatic sync interval'],
  ['常见值：clash-verge/v2.5.1、clash.meta/1.19.20、Clash', 'Common values: clash-verge/v2.5.1, clash.meta/1.19.20, Clash'],
  ['搜索 GeoSite 与 GeoIP', 'Search GeoSite and GeoIP'], ['输入关键词，例如', 'Enter a keyword, such as'],
  ['正在查询 Geo 数据索引…', 'Searching the Geo index…'], ['没有找到匹配的 Geo 规则', 'No matching Geo rules found'],
  ['创建规则', 'Create rule'], ['新建规则', 'New rule'], ['关闭新建规则', 'Close new rule dialog'],
  ['规则汇总', 'Rule library'], ['规则分类', 'Rule categories'], ['所有规则', 'All rules'],
  ['全部规则', 'All rules'],
  ['自定义规则', 'Custom rules'], ['手动维护', 'Manual maintenance'], ['自定义维护', 'Custom maintenance'], ['上游订阅', 'Upstream subscriptions'],
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
  ['基础设置', 'Basic settings'], ['基础配置', 'Basic configuration'], ['站点基础 URL', 'Site base URL'], ['默认策略组名称', 'Default policy group'],
  ['分类图标包', 'Category icon packs'], ['图标包', 'Icon packs'], ['预置', 'Built in'], ['图标包名称', 'Icon pack name'],
  ['的图标包名称', ' icon pack name'], ['的订阅地址', ' subscription URL'],
  ['添加图标包', 'Add icon pack'], ['移除自定义图标包', 'Remove custom icon pack'],
  ['数据备份', 'Data backup'], ['导出完整备份', 'Export full backup'], ['恢复备份', 'Restore backup'],
  ['文件格式', 'File format'], ['下载备份文件', 'Download backup'], ['选择文件', 'Choose file'],
  ['更换文件', 'Change file'], ['开始恢复', 'Restore now'], ['保存全部设置', 'Save all settings'],
  ['服务状态', 'Service status'], ['应用数据库', 'Application database'], ['后台密码', 'Admin password'], ['已连接', 'Connected'], ['未连接', 'Not connected'], ['已配置', 'Configured'], ['未配置', 'Not configured'],
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
  ['可勾选后批量维护', 'Select rules for bulk maintenance'], ['全不选', 'Deselect all'], ['全选', 'Select all'], ['已选择', 'Selected'],
  ['启用', 'Enable'], ['禁用', 'Disable'], ['复制', 'Copy'], ['删除', 'Delete'], ['默认顺序', 'Default order'],
  ['启用状态', 'Enabled status'], ['升序', 'Ascending'], ['降序', 'Descending'], ['切换排序方向', 'Toggle sort direction'],
  ['Key 数量', 'Key count'], ['备注，例如：自动化服务', 'Note, e.g. automation service'], ['未命名 Key', 'Unnamed key'],
  ['暂无 API Key', 'No API keys'], ['填写备注后即可创建多个独立 Key', 'Add a note to create multiple independent keys'], ['创建于', 'Created'],
  ['通过 API Key 读取和远端维护规则数据库', 'Read and remotely maintain the rules database through API keys'],
  ['复制地址', 'Copy address'], ['API 地址已复制', 'API URL copied'], ['点击规则可进行维护', 'Click a rule to manage it'],
  ['维护规则', 'Manage rule'], ['关闭规则操作', 'Close rule actions'],
  ['通过 API Key 读取和维护规则数据库', 'Read and maintain the rules database through API keys'], ['点击复制', 'Click to copy'],
  ['搜索域名、关键词、IP、类型、来源或分类', 'Search domains, keywords, IPs, types, sources, or categories'],
  ['可单条维护或批量管理', 'Manage rules individually or in bulk'], ['管理', 'Manage'], ['全选当前搜索结果', 'Select current search results'],
  ['更多', 'More'], ['编辑单条规则', 'Edit rule'], ['修改规则地址、类型和备注', 'Edit the rule address, type, and note'],
  ['保存修改', 'Save changes'], ['确认删除', 'Confirm delete'], ['删除后页面会提供一次撤销机会。', 'You can undo this deletion once.'],
  ['已删除', 'Deleted'], ['撤销', 'Undo'], ['关闭撤销提示', 'Dismiss undo message'],
  ['管理规则', 'Manage rules'], ['退出管理', 'Exit management'], ['退出', 'Exit'], ['修改', 'Modify'], ['启用/禁用', 'Enable/disable'], ['批量选择与维护', 'Select and maintain rules in bulk'], ['批量操作', 'Bulk actions'],
  ['规则选择管理', 'Rule selection management'], ['选择规则后修改启用状态', 'Select rules to change their status'],
  ['删除后无法撤销，请确认所选规则无误。', 'Deletion cannot be undone. Please verify the selected rules.'], ['规则已删除', 'Rule deleted'],
  ['例如', 'Example'], ['可留空', 'Optional'], ['一行一条，预览确认后再导入', 'One rule per line; preview before importing'],
  ['条启用规则', ' enabled rules'], ['条规则', ' rules'], ['个上游', ' upstream sources'], ['个 GeoSite', ' GeoSite'], ['个 GeoIP', ' GeoIP'],
  ['已同步', 'Synced'], ['同步于', 'Synced'], ['私密', 'Private'], ['公开', 'Public'], ['已禁用', 'Disabled'],
  ['条', 'rules'], ['暂无', 'No '],
];

const orderedEnglishPhrases = [...ENGLISH_PHRASES].sort((a, b) => b[0].length - a[0].length);
const TRADITIONAL_PHRASES: Array<[string, string]> = [
  ['訂閱地址', '訂閱網址'], ['數據庫', '資料庫'], ['自定義', '自訂'], ['默認', '預設'],
  ['圖標', '圖示'], ['文件', '檔案'], ['後臺', '後台'], ['站點', '網站'], ['界面', '介面'],
  ['設置', '設定'], ['數據', '資料'], ['添加', '新增'], ['保存', '儲存'], ['恢復', '還原'],
  ['導出', '匯出'], ['訪問', '存取'], ['鏈接', '連結'],
];
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
    .replace(/每\s*(\d+)\s*小时/g, 'Every $1 hours')
    .replaceAll('，', ', ')
    .replaceAll('：', ': ')
    .replaceAll('、', ', ')
    .replaceAll('。', '.');
  return output;
}

export function translateUiText(text: string, locale: ResolvedLocale) {
  if (locale === 'zh-CN') return text;
  if (locale === 'zh-TW') {
    let output = toTraditional?.(text) ?? text;
    for (const [source, target] of TRADITIONAL_PHRASES) output = output.replaceAll(source, target);
    return output;
  }
  return english(text);
}

function translateTextNode(node: Text, locale: ResolvedLocale) {
  const current = node.nodeValue ?? '';
  const previous = trackedText.get(node);
  const source = previous && current === previous.rendered ? previous.source : current;
  const rendered = translateUiText(source, locale);
  trackedText.set(node, { source, rendered });
  if (current !== rendered) node.nodeValue = rendered;
}

function translateAttribute(element: Element, name: string, locale: ResolvedLocale) {
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

function localizeNode(root: Node, locale: ResolvedLocale) {
  if (root instanceof Text) {
    translateTextNode(root, locale);
    return;
  }
  if (!(root instanceof Element) || root.matches('script, style, code, pre, [data-no-translate]')) return;
  for (const name of ['placeholder', 'aria-label', 'title']) translateAttribute(root, name, locale);
  for (const child of root.childNodes) localizeNode(child, locale);
}

function localizeDocument(locale: ResolvedLocale, preference?: AppLocale) {
  if (document.body) localizeNode(document.body, locale);
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  document.documentElement.dataset.localePreference = preference ?? locale;
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
    return saved === 'zh-CN' || saved === 'zh-TW' || saved === 'en' || saved === 'system' ? saved : 'system';
  });
  const [systemLocale, setSystemLocale] = useState<ResolvedLocale>(detectSystemLocale);
  const resolvedLocale = locale === 'system' ? systemLocale : locale;

  useLayoutEffect(() => {
    const update = () => setSystemLocale(detectSystemLocale());
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);

  useLayoutEffect(() => {
    localStorage.setItem('private-rules-locale', locale);
    if (resolvedLocale === 'zh-TW') void ensureTraditionalConverter().then(() => localizeDocument(resolvedLocale, locale));
    else localizeDocument(resolvedLocale, locale);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target as Text, resolvedLocale);
        else for (const node of record.addedNodes) localizeNode(node, resolvedLocale);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [locale, resolvedLocale]);

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale: (next) => {
    if (next === locale) return;
    const commit = () => runUiTransition('locale', () => {
      flushSync(() => setLocaleState(next));
      const resolvedNext = next === 'system' ? systemLocale : next;
      localizeDocument(resolvedNext, next);
    });
    const resolvedNext = next === 'system' ? systemLocale : next;
    if (resolvedNext === 'zh-TW') void ensureTraditionalConverter().then(commit);
    else commit();
  } }), [locale, systemLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function transitionTheme(update: () => void) {
  runUiTransition('theme', update);
}
