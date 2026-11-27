/**
 * Software-picker copy (design revision §3). Kept out of the shared `zh-CN.pages` dictionary so
 * that visiting Rules, Subscriptions or Templates never downloads or parses software guidance:
 * the strings travel with the AppPicker chunk instead (see `extendZhCNDictionary` in ./index).
 */
export const zhCNApps = {
  'apps.picker.title': '你用的是哪个软件？',
  'apps.picker.platformLabel': '选择平台',
  'apps.picker.platform.iphone': 'iPhone / iPad',
  'apps.picker.platform.mac': 'Mac',
  'apps.picker.platform.windows': 'Windows',
  'apps.picker.platform.android': '安卓',
  'apps.picker.platform.linux-router': 'Linux / 路由器',
  'apps.picker.searchLabel': '搜索软件',
  'apps.picker.searchPlaceholder': '搜索软件名',
  'apps.picker.emptySearch': '没有找到匹配的软件，换个名字试试。',
  'apps.picker.rulesOnlyHint': '暂时只能用分流规则',
  'apps.picker.multipleHint': '手机和电脑都要用？这里可以多选。',
  'apps.picker.singleHint': '先选一个现在要用的软件。',
  'apps.picker.selectedCount': '已选 {count} 个',
  'apps.picker.notSureTitle': '不知道自己用的是哪个？',
  'apps.picker.notSureBody':
    '打开手机或电脑上的代理软件，对照上面的图标找一找；实在找不到也没关系，可以先只用分流规则。',
  'apps.picker.noAppTitle': '还没有装软件？',
  'apps.picker.noAppBody': '可以先看看这些常用的（这里只列名称，不提供下载）：',
  'apps.picker.yourApp': '你的软件',
  'apps.picker.chooseApp': '选择你用的软件',
  'apps.ruleHowTo.shadowrocket':
    '1. 打开 Shadowrocket，点右上角「+」\n2. 粘贴刚复制的地址并保存\n3. 回到首页选中它，打开顶部开关',
  'apps.ruleHowTo.quantumult-x':
    '1. 打开 Quantumult X，进入「分流」\n2. 添加远程资源并粘贴地址，然后更新\n3. 回到首页打开开关',
  'apps.ruleHowTo.loon': '1. 打开 Loon，进入「远程规则」\n2. 粘贴地址并更新\n3. 选中这份配置，打开开关',
  'apps.ruleHowTo.surge': '1. 打开 Surge，选择从地址下载配置\n2. 粘贴地址并保存\n3. 选中这份配置并开启',
  'apps.ruleHowTo.stash': '1. 打开 Stash，在「配置」里从地址下载\n2. 粘贴地址并保存\n3. 选中它，回到首页打开开关',
  'apps.ruleHowTo.egern': '1. 打开 Egern，进入「配置」\n2. 添加远程地址并粘贴，然后更新\n3. 选中这份配置并开启',
  'apps.ruleHowTo.sing-box': '1. 打开 sing-box，新建远程配置\n2. 粘贴地址并更新\n3. 选中它并连接',
  'apps.ruleHowTo.clash-verge-rev':
    '1. 打开 Clash Verge Rev，进入「订阅」\n2. 粘贴地址并保存，选中它\n3. 打开「系统代理」开关',
  'apps.ruleHowTo.clash-party': '1. 打开 Clash Party，进入「订阅」\n2. 粘贴地址并保存，选中它\n3. 打开「系统代理」开关',
  'apps.ruleHowTo.flclash': '1. 打开 FlClash，进入「订阅」\n2. 粘贴地址并更新，选中它\n3. 打开代理开关',
  'apps.ruleHowTo.clash-meta-android':
    '1. 打开 Clash Meta for Android，在「配置」里从地址导入\n2. 粘贴地址并保存\n3. 选中它并打开开关',
  'apps.ruleHowTo.karing': '1. 打开 Karing，添加远程地址\n2. 粘贴地址并选中\n3. 连接即可',
  'apps.ruleHowTo.surfboard': '1. 打开 Surfboard，在「配置」里添加远程配置\n2. 粘贴地址并保存\n3. 选中它使用',
  'apps.ruleHowTo.openclash': '1. 打开 OpenClash 的「配置文件」\n2. 添加订阅地址并粘贴，然后更新\n3. 选用这份配置',
  'apps.ruleHowTo.clashmi': '1. 打开 ClashMi，进入「订阅」\n2. 粘贴地址并更新，选中它\n3. 打开开关',
  'apps.ruleHowTo.hiddify': '1. 打开 Hiddify，添加远程配置\n2. 粘贴地址并保存\n3. 选中它并连接',
  'apps.howTo.shadowrocket': '打开 Shadowrocket，点右上角「+」，粘贴上面的链接并保存；回到首页选中它，再打开顶部开关。',
  'apps.howTo.quantumult-x': '打开 Quantumult X，在「分流」里添加远程资源，粘贴链接后更新；再回到首页开启开关。',
  'apps.howTo.loon': '打开 Loon，在远程规则里添加链接并更新，再选中这份配置。',
  'apps.howTo.surge': '打开 Surge，选择从链接下载配置，粘贴后切换到这份配置并开启。',
  'apps.howTo.stash': '打开 Stash，在「配置」里从链接下载，粘贴后选中它，回到首页开启。',
  'apps.howTo.egern': '打开 Egern，在配置里添加远程链接并更新，然后选中它。',
  'apps.howTo.sing-box': '打开 sing-box，新建远程配置并粘贴链接，更新后选中这份配置。',
  'apps.howTo.clash-verge-rev': '打开 Clash Verge Rev，在「订阅」里新建并粘贴链接，保存后选中它，再打开系统代理。',
  'apps.howTo.clash-party': '打开 Clash Party，在「订阅」里新建并粘贴链接，保存后选中它，再打开系统代理。',
  'apps.howTo.flclash': '打开 FlClash，在「订阅」里添加链接并更新，选中后开启代理。',
  'apps.howTo.clash-meta-android': '打开 Clash Meta for Android，在「配置」里从链接导入，选中后开启。',
  'apps.howTo.karing': '打开 Karing，添加远程链接，粘贴后选中并连接。',
  'apps.howTo.surfboard': '打开 Surfboard，在「配置」里添加远程配置，粘贴链接后选中使用。',
  'apps.howTo.openclash': '在 OpenClash 的「配置文件」里添加订阅链接，更新后选用这份配置。',
  'apps.howTo.clashmi': '打开 ClashMi，在「订阅」里添加链接并更新，选中后开启。',
  'apps.howTo.hiddify': '打开 Hiddify，添加远程配置并粘贴链接，保存后选中连接。',
} as const;

export type AppMessageKey = keyof typeof zhCNApps;
