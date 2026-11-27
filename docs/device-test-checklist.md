# Private Rules 1.1.0 真机验证清单（Device Test Checklist）

本文档列出所有支持客户端在 **真机 / 真实客户端环境** 下的必检验证项。重点覆盖 **C 类客户端（Loon、Quantumult X、Shadowrocket）** 的安全默认行为、导入方式、是否会覆盖用户已有节点订阅、节点筛选与分流正确性，以及 A/B 类客户端回归核对。

> **状态说明（1.1.0 M5.3）**：Loon 与 Quantumult X 的**完整配置模式**目前尚未完成真机实测，因此发布上的「实验性完整配置」开关默认关闭；默认仅输出「仅规则资源」模式，避免误导入覆盖用户已有节点订阅。完成下方对应客户端全部勾选并确认无误后，方可评估调整默认策略。

---

## 通用前置准备

1. 准备一台已部署 Private Rules 1.1.0 的测试实例（确保 `BASE_URL`、`SESSION_SECRET`、`RULE_TOKEN` 均已正确配置）。
2. 在「发布管理」中分别准备两组测试发布：
   - **纯规则发布（无节点绑定）**：`access = public` 与 `access = token` 各一；
   - **含节点发布（已绑定机场节点槽）**：确认 `access` 强制只能为 `token` 或 `disabled`，无法切换为 `public`；访问 `/p/:slug/<file>` 返回 `404`。
3. 导入前，先在客户端内 **导出/备份现有主配置与节点订阅**。

---

## 1. Loon（iOS / macOS — C 类客户端）

### 1.1 安全默认：仅规则资源模式（`experimentalFullConfig = false`，默认）

- [ ] **导入方式**：
  - 打开 Loon →「配置」→「规则」→「远程规则」→ 添加发布链接 `.../loon.conf`（或在主配置 `[Remote Rule]` 段中作为远程规则资源引入）。
  - 确认导入后 **不会** 弹出“覆盖主配置文件”提示。
- [ ] **是否覆盖已有节点订阅**：
  - 导入并更新远程规则后，检查「节点」→「远程节点订阅（`[Remote Proxy]`）」与已有「策略组（`[Proxy Group]`）」**完全未被修改或清空**。
- [ ] **规则语法与解析**：
  - 无语法报错日志；`DEST-PORT`（由 `DST-PORT` 映射）、`SRC-PORT`、`IP-CIDR6`、`no-resolve`、`AND`/`OR`/`NOT`（双括号语法）、`REJECT-DROP` 均可被 Loon 正常解析。
  - 若包含 `PROCESS-NAME` 规则：在 Loon macOS 上生效；在 Loon iOS 上不导致解析失败（仅忽略），与兼容性报告提示一致。
- [ ] **Local-First 优先级**：
  - 排在本地规则之前的远程规则列表已被自动内联输出，请求测试确认其命中优先级高于后续本地规则。

### 1.2 实验模式：完整配置（`experimentalFullConfig = true`，未经真机验证）

- [ ] **界面与报告提示**：
  - 发布编辑弹窗开启「实验性完整配置」时，界面显示醒目警告；预览兼容性报告中出现 `EXPERIMENTAL_FULL_CONFIG_UNVERIFIED`（明确注明「未经真机验证」）。
- [ ] **导入前备份与覆盖行为确认**：
  - 在**全新/测试配置槽**导入 `.../loon.conf`（切勿直接覆盖主力配置）。
  - 实测记录：通过 URL 导入完整配置是否会替换 `[Remote Proxy]` 中已有节点订阅（预期：会新建或替换配置文件，需手动在 `[Remote Proxy]` 添加机场订阅）。
- [ ] **`[Remote Filter]` 与节点筛选**：
  - 手动添加机场节点订阅后，检查 `[Remote Filter]` 中的 `NameRegex` 是否正确匹配各地区节点（香港/台湾/日本/新加坡/美国等）并过滤掉“剩余流量/到期/官网”等信息节点。
  - 测试两段式降级（当出现不支持或异常正则时降级为 `NameKeyword`）：检查 `# Two-stage node filter` 注释与策略组可用性。
- [ ] **分流与基础段验证**：
  - `full` 模式检查 `[General]` DNS、skip-proxy、bypass-tun 生效；`minimal` 模式确认省略 `[General]` 后仍可合并使用。
  - 实测国内直连（如 `baidu.com`）、AI/海外代理（如 `openai.com` / `google.com`）、广告拦截（`REJECT` / `REJECT-DROP`）、兜底（`FINAL`）均命中预期策略组。

---

## 2. Quantumult X（iOS / macOS — C 类客户端）

### 2.1 安全默认：`filter_remote` 仅规则资源模式（`experimentalFullConfig = false`，默认）

- [ ] **导入方式**：
  - 打开 Quantumult X →「分流」→「引用（`[filter_remote]`）」→ 新建资源，填入发布链接 `.../qx.conf` 并指定默认策略，执行更新。
  - 确认 `filter.snippet` 风格的小写规则（`host`、`host-suffix`、`host-keyword`、`ip-cidr`、`ip6-cidr`、`ip-asn`、`geoip`、`user-agent`）能被无报错解析。
- [ ] **是否覆盖已有节点订阅**：
  - 更新规则资源后，检查 `[server_remote]` 与 `[server_local]` 节点列表、已有 `[policy]` 策略组 **100% 保持原样，无覆盖风险**。
- [ ] **不支持规则跳过验证**：
  - 模板中含 `AND`/`OR`/`NOT` 逻辑规则或 `DST-PORT` / `PROCESS-NAME` / `URL-REGEX` 时，QX 输出中不包含这些条目（无解析报错），且预览兼容性报告中完整列出 `UNSUPPORTED_LOGICAL_RULE` / `UNSUPPORTED_RULE_TYPE` 与跳过计数。
  - 确认输出中不含 `,no-resolve` 参数，IPv6 规则以 `ip6-cidr` 输出，`REJECT-DROP` 已降级为 `reject`。
- [ ] **Local-First 优先级**：
  - 排在本地规则之前的远程规则列表已内联，验证在 QX 中命中顺序符合预期。

### 2.2 实验模式：完整配置（`experimentalFullConfig = true`，未经真机验证）

- [ ] **界面与报告提示**：
  - 开启实验开关后，弹窗显示醒目警告；预览兼容性报告含 `EXPERIMENTAL_FULL_CONFIG_UNVERIFIED`（「未经真机验证」）。
- [ ] **导入前备份与覆盖行为确认**：
  - 备份当前 QX 配置文件，通过「下载配置文件」导入 `.../qx.conf` 到独立测试环境。
  - 实测记录：下载完整配置是否会替换原主配置中的 `[server_remote]`（预期会替换整份配置，需手动将原 `[server_remote]` 粘回）。
- [ ] **`[policy]` 与正则两段式降级（`re2-safe`）**：
  - 确认 `static`、`url-latency-benchmark`、`available`、`dest-hash`、`img-url` 解析正常。
  - 确认所有 `server-tag-regex=` 不含负向前瞻 `(?!...)` 或后顾 `(?<!...)`（避免 QX 正则引擎解析失败）；触发排除词时确认兼容性报告显示 `REGEX_DEGRADED_TWO_STAGE`，并检查注释中的两段式排除提示。
- [ ] **分流与基础段验证**：
  - `full` 模式验证 `[general]` 与 `[dns]` 段生效；`minimal` 模式确认省略 `[general]` 与 `[dns]`。
  - 实测直连、代理、广告拦截（`reject`）及 `final` 兜底策略命中正确。

---

## 3. Shadowrocket（iOS / macOS — C 类客户端）

> Shadowrocket 默认输出完整配置（含 `[General]`（`full` 模式）、`[Proxy Group]`、`[Rule]`），节点订阅仍由用户在 Shadowrocket 客户端内独立管理（节点列表与配置文件分离）。

- [ ] **导入方式**：
  - 打开 Shadowrocket →「配置」→「添加配置」→ 粘贴发布链接 `.../shadowrocket.conf` →「使用配置」。
- [ ] **是否覆盖已有节点订阅**：
  - 切换启用该配置后，返回「首页」检查已有服务器订阅与手工节点 **全部保留、未被清除**。
- [ ] **`[Proxy Group]` 与节点正则筛选（`icu-no-lookbehind`）**：
  - 验证 `select`、`url-test`、`fallback`、`load-balance` 策略组均可正常展开并测速。
  - 验证带负向前瞻 `(?!...)` 的 `policy-regex-filter=` 能正常筛选对应地区节点并排除信息节点。
  - 验证含负向后顾 `(?<!...)` 的自定义筛选会自动降级为两段式（报告含 `REGEX_DEGRADED_TWO_STAGE`），且不会导致 Shadowrocket 策略组为空或报错。
  - 确认输出中不含 `icon-url` / `img-url` 等不支持参数。
- [ ] **`[Rule]` 顺序、IPv6 与逻辑规则**：
  - 确认 `RULE-SET,<url>,<policy>` 严格按自上而下顺序生效。
  - 确认 IPv6 规则以 `IP-CIDR`（非 `IP-CIDR6`）输出且可正常解析，`,no-resolve` 生效。
  - 确认 `AND`/`OR`/`NOT` 逻辑规则与 `REJECT-DROP`、`FINAL` 正常生效；`DST-PORT` / `PROCESS-NAME` 已跳过并在报告注明。
- [ ] **`full` vs `minimal` 分流实测**：
  - `full` 模式检查 `[General]`（`bypass-tun`、`dns-server`、`ipv6`、`prefer-ipv6`）生效；`minimal` 模式检查省略 `[General]` 后仍可用。
  - 实测国内直连、海外代理、AI 专用组、广告拦截与 `FINAL` 兜底均正确分流。

---

## 4. Mihomo / Clash Meta（A 类客户端回归）

- [ ] **导入方式**：使用 `.../mihomo.yaml`（含节点发布必须为 `/t/<token>/<slug>/mihomo.yaml`）。
- [ ] **节点与分流**：`proxy-providers` 自动拉取节点订阅且自定义 `User-Agent` 生效；地区策略组正则筛选、MRS/YAML 规则集、DNS（fake-ip / redir-host）、`MATCH` 兜底均正常工作。
- [ ] **安全核对**：切换 `access = public` 对含节点发布应被阻止；纯规则发布可通过 `/p/<slug>/mihomo.yaml` 正常导入。

---

## 5. Stash（iOS / macOS — A 类客户端回归）

- [ ] **导入方式**：使用 `.../stash.yaml` 导入配置。
- [ ] **节点与分流**：`proxy-providers` 正常拉取（使用单值 `headers`）；策略组图标、YAML/classical 规则集、DNS 及分流均正常无报错。

---

## 6. Surge（iOS / macOS — A 类客户端回归）

- [ ] **导入方式**：使用 `.../surge.conf` 作为托管配置导入。
- [ ] **节点与分流**：`policy-path=` 正常拉取节点，`policy-regex-filter=` 筛选地区节点；`RULE-SET`、逻辑规则、`DEST-PORT` / `SRC-IP`、`FINAL,dns-failed` 均正常工作；`minimal` 模式省略 `[General]`。

---

## 7. sing-box（全平台 — B 类客户端回归）

- [ ] **导入方式**：使用 `.../singbox.json` 导入（含节点发布必须使用 `/t/<token>/<slug>/singbox.json`）。
- [ ] **节点快照与兜底**：验证服务端自动抓取解析订阅节点并注入 `outbounds`（支持 SS/VMess/VLESS/Trojan/Hysteria2/TUIC/WireGuard）；上游短暂失败时返回过期快照并携带 `X-Node-Snapshot-Stale: true` 响应头。
- [ ] **分流与规则集**：验证 SRS / JSON 规则集、路由规则、`final` 出站及 `full` / `minimal` 输出正常。

---

## 一键导入链接核实

以下全部为**待核实协议候选**，不是已支持的一键导入功能。原始生成器仅供真机测试；M3 接入界面时必须使用下方的 `getImportLink()` 核实门禁。

测试前备份客户端配置；用中文名称（例如「流媒体测试」）及带 token、多个查询参数的链接分别验证，确认 token 未被截断或二次解码。将测试版本、系统、日期与截图记入签收记录；不要在截图、日志或公开记录中暴露真实 token。

| 客户端          | 平台                                                               | 链接格式（待核实）                                              | 核实步骤                                                                                                                                                             | 结果 |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Clash Verge Rev | Windows / macOS / Linux                                            | `clash://install-config?url=<encoded>&name=<encoded name>`      | 在电脑浏览器打开链接，确认唤起客户端导入，显示正确名称与节点；检查带 token 的地址可更新。                                                                            | 待测 |
| FlClash         | Android / Windows / macOS / Linux                                  | `clash://install-config?url=<encoded>&name=<encoded name>`      | 在手机/电脑浏览器打开链接，确认唤起客户端导入，显示正确名称与节点；检查带 token 的地址可更新。                                                                       | 待测 |
| Clash Party     | Windows / macOS / Linux                                            | `clash://install-config?url=<encoded>&name=<encoded name>`      | 在电脑浏览器打开链接，确认唤起客户端导入，显示正确名称与节点；检查带 token 的地址可更新。                                                                            | 待测 |
| Stash           | iOS / macOS                                                        | `stash://install-config?url=<encoded>`                          | 在手机/电脑浏览器打开链接，确认客户端弹出导入并显示正确名称与节点；名称应从配置/URL 正确识别（协议不带 name）。                                                      | 待测 |
| Surge           | iOS / macOS                                                        | `surge:///install-config?url=<encoded>`                         | 在手机/电脑浏览器打开链接，确认客户端弹出导入并显示正确名称与节点；名称应从配置/URL 正确识别（协议不带 name）。                                                      | 待测 |
| sing-box        | Android / iOS / macOS / Windows / Linux（取决于 GUI 是否注册协议） | `sing-box://import-remote-profile?url=<encoded>#<encoded name>` | 在手机/电脑浏览器打开链接，确认对应 GUI 弹出远程配置导入，片段中的中文名称与节点正确；记录 GUI 名称和版本，CLI 不代表协议已支持。                                    | 待测 |
| Shadowrocket    | iOS / macOS                                                        | `shadowrocket://config/add/<url>`                               | 在手机/电脑浏览器打开链接，确认客户端弹出添加配置并显示正确名称与节点；特别检查嵌入的原始 URL 和 token 完整、原有节点未被覆盖。                                      | 待测 |
| Quantumult X    | iOS / macOS                                                        | `quantumult-x:///add-resource?remote-resource=<encoded JSON>`   | 在手机/电脑浏览器打开链接，确认客户端弹出规则资源导入并显示正确名称；确认原有节点正确且不被覆盖，核实 JSON 资源类型与 tag 语法；此候选不承诺导入完整配置或新增节点。 | 待测 |
| Loon            | iOS / macOS                                                        | 暂无；返回 `null`                                               | 先确定协议格式，再在手机/电脑浏览器打开候选链接，确认客户端弹出导入并显示正确名称与节点；未确定前继续手动导入。                                                      | 待测 |

编码规则：URL 查询值和 mihomo 的 name、sing-box 的名称片段用 `encodeURIComponent` 编码一次；Shadowrocket 按候选格式嵌入原始 URL。Quantumult X 的 JSON 候选为 `{"filter_remote":["<url>, tag=<name>, enabled=true"]}`，整体编码一次，用于默认「仅规则资源」输出；完整配置的导入协议另行核实，不要直接复用此候选。

核实通过后，把 `src/shared/client-import.ts` 对应项改为 `verified:true`。Clash 三种客户端共用 mihomo 项，须全部核实后再开启；如果平台或 GUI 之间支持不同，先细分元数据，不能用一个平台的结果替所有平台背书。Loon 还须先补生成器与格式。未经核实保持 `verified:false`，M3 界面仅使用 `getImportLink(clientId, url, name)`（未核实返回 `null`，隐藏按钮），不要使用原始生成器绕过门禁；本次不接界面。

---

## 验收签收记录

| 客户端 | 测试版本 / 系统 | 测试模式 | 是否覆盖已有节点 | 分流结果 | 测试人 / 日期 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| Loon | | 仅规则资源 / 实验完整 | | | | |
| Quantumult X | | 仅规则资源 / 实验完整 | | | | |
| Shadowrocket | | 完整配置 | | | | |
| Mihomo | | 完整配置 | | | | |
| Stash | | 完整配置 | | | | |
| Surge | | 完整配置 | | | | |
| sing-box | | 完整配置 | | | | |
