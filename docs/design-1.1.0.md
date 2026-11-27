# Private Rules 1.1.0 项目设计方案

| 项目 | 内容 |
| --- | --- |
| 文档版本 | r3（落实 1.1.0 评审决策：错误格式、规则类型与 IPv6 归一、迁移策略、节点加密前提、备份版本 2、输出档位与发布路径、CSRF/CORS 边界、前端并存与待定项标记） |
| 目标版本 | 1.1.0（基于 1.0.6 的完整重构） |
| 日期 | 2026-11-26 |
| 状态 | 待评审 |
| 适用范围 | 产品范围、架构、数据模型、模板系统、前端设计系统、安全、测试、迁移与里程碑 |

> 版本约定：项目名称保持 **Private Rules**，不使用 v1 / v2 之类的代号。重构成果以 **1.1.0** 发布；现有版本称为 **1.0.x**。分支、目录、模块命名中都不出现版本代号。

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [1.0.6 现状评估](#2-106-现状评估)
3. [产品定位与核心概念](#3-产品定位与核心概念)
4. [功能范围](#4-功能范围)
5. [总体架构](#5-总体架构)
6. [技术选型](#6-技术选型)
7. [目录结构](#7-目录结构)
8. [数据模型](#8-数据模型)
9. [规则引擎](#9-规则引擎)
10. [模板系统](#10-模板系统)
11. [节点接入](#11-节点接入)
12. [API 设计](#12-api-设计)
13. [前端设计](#13-前端设计)
14. [安全设计](#14-安全设计)
15. [性能与缓存](#15-性能与缓存)
16. [测试策略](#16-测试策略)
17. [兼容与迁移](#17-兼容与迁移)
18. [版本与发布](#18-版本与发布)
19. [里程碑与工作量](#19-里程碑与工作量)
20. [风险与待验证项](#20-风险与待验证项)
21. [附录](#21-附录)

---

## 1. 背景与目标

### 1.1 背景

Private Rules 1.0.x 是一个自托管的规则管理与订阅发布控制台，支持 Cloudflare Workers + D1 与 Docker（Node.js + SQLite）两种部署方式。它已经具备多来源聚合、来源级同步、按规则集控制访问、多格式输出等能力。

1.0.x 的实现存在三个方面的问题：

- 前端风格与预期的 Miku 主题不一致，代码结构难以维护；
- 后端存在会导致数据丢失和凭据泄露的缺陷；
- 只能发布"规则集"，不能发布可直接导入客户端的"完整分流配置"。

### 1.2 目标

1. **重建前端**：统一的 Miku 设计系统，桌面、平板、手机一致可用，可维护、可测试。
2. **重建后端**：分层清晰、输入全部校验、表结构单一来源、修复全部已知缺陷。
3. **新增规则模板**：按应用类型组合规则，编译输出到各主流客户端，这是 1.1.0 的核心新功能。
4. **保持兼容**：1.0.x 的订阅地址不变，数据库可无损升级。
5. **为后续功能打基础**：模块边界清晰，新功能以独立模块加入。

### 1.3 非目标

- 不做节点管理（导入、编辑、聚合节点，流量统计）。节点由内核或客户端负责，详见第 11 节。
- 不提供代理连接，不做在线订阅转换服务。
- 不做多用户 / 多租户。1.1.0 仍是单管理员的私有控制台。

---

## 2. 1.0.6 现状评估

### 2.1 代码规模

| 部分 | 规模 | 说明 |
| --- | --- | --- |
| 前端 TSX / TS | 2,390 行 | 平均每行约 146 个字符，实际约相当于 6–7k 行；`rules-panel.tsx` 单文件 58KB |
| 前端 CSS | 6 个文件，1,960 行，98KB | `neko-ui.css` 78KB，层层覆盖 |
| 后端 TS | 5,062 行 | `db.ts` 980 行、`app.ts` 510 行 |
| 打包产物 | 主 JS 764KB（gzip 后 177KB）、繁体转换包 1.09MB、头像 PNG 2.08MB、favicon 466KB | 首屏偏重 |
| 测试 | 122 个单元 / 集成 / 契约测试，10 个 e2e | 全部通过（修复 Node 26 兼容问题后） |

### 2.2 前端问题

1. 代码中没有 Miku 主题定义；主色是 `#0867f2`，混有灰黑与多种青色；登录页背景不是 Miku 形象。
2. 多语言通过 `MutationObserver` 在 React 渲染后改写页面文字，与 React 更新冲突，文案没有类型约束。
3. 所有数据集中在一个 hook（`use-domain-admin.ts`）里，每次进页面 `/api/categories`、`/api/auth/me`、`/api/api-keys` 各请求两次，没有缓存；版本号被写死为 `1.0.5`。
4. 进入页面、切换主题和语言时有模糊加缩放动画，过渡最长 2.8 秒，内容要 2–4 秒才清晰。
5. 没有路由，靠 `?view=` 参数与 localStorage 切换页面。

### 2.3 后端缺陷

| 级别 | 缺陷 | 已验证 |
| --- | --- | --- |
| P0 | 导入备份先删空全部表再逐条插入，没有事务和格式校验；格式错误的备份会清空数据 | 是 |
| P0 | `/api/links` 无视鉴权方式返回 `RULE_TOKEN`，API Key 调用方可拿到订阅 Token | 是 |
| P0 | 登录没有频率限制；密码、Token、Cookie 签名用 `===` 比较 | 是 |
| P1 | 限流身份直接读取 `x-forwarded-for`，不检查 `TRUST_PROXY`，可伪造 | 代码审查 |
| P1 | 错误处理靠正则匹配中文错误消息区分 400 / 500 | 代码审查 |
| P1 | 批量导入对每条规则全表扫描冲突（N×M），再逐条插入 | 代码审查 |
| P1 | 每次请求订阅都把所有分类与规则加载进内存 | 代码审查 |
| P1 | 表结构写在 `migrations/` 与 `ensureDatabase` 的运行时 ALTER 两处 | 代码审查 |
| P2 | Token 模式下链接接口仍返回公开地址（访问为 404） | 是 |
| 已修 | `new Request(url, request)` 在 Node 26 上抛出 `Illegal invocation`，`/admin` 返回 500 | 已修复，未提交 |

### 2.4 可以保留的部分

- 规则解析（`parser.ts`）、规则精简（`rule-compactor.ts`）、多格式输出（`formatters`）、GeoSite / GeoIP 解析等纯逻辑及其测试。
- 同步流程的设计：先写暂存表，再整批替换，并用租约（lease）防止并发同步。
- 远程来源的 SSRF 防护（`remote-source-security.ts`）。
- Telegram Bot 与 Mini App 的业务能力（需要重新整理代码结构）。

---

## 3. 产品定位与核心概念

### 3.1 定位

> **一个私有的规则与分流配置工作台**：把自己维护的规则、社区规则和 GeoSite / GeoIP 数据整理成规则集，再按应用类型组合成模板，编译为各客户端可直接导入的配置；节点交给内核或客户端，敏感信息只留在自己的服务器上。

与参考项目的差异：

| | miaomiaowu | Tower | Private Rules 1.1.0 |
| --- | --- | --- | --- |
| 形态 | 服务端（Go） | 本机应用（SwiftUI） | 服务端（Workers / Docker） |
| 模板 | 每个客户端手写一份配置文件，文本占位替换 | 方案 + 定制层，按能力矩阵生成 | 与客户端无关的中间结构，按能力矩阵编译 |
| 规则来源 | 第三方 URL | 内置 ACL4SSR、blackmatrix7 | **自己的规则集** + 规则目录 + 远程 URL |
| 编辑方式 | 外部发布 JSON 后同步 | App 内编辑 | 网页编辑，支持版本与对比 |
| 订阅地址 | 常驻 | 依赖本机运行或局域网 | 常驻 |
| 节点 | 完整节点管理 | 解析订阅与自有节点 | 只做引用与基础解析（第 11 节） |

### 3.2 核心概念

```
规则来源 ──同步──▶ 规则集 ──引用──▶ 应用组件 ──组合排序──▶ 模板 ──绑定节点槽位──▶ 发布 ──编译──▶ 客户端配置
                     │                                                          │
                     └──────────────── 直接发布（1.0.x 能力）────────────────────┘
```

| 概念 | 说明 |
| --- | --- |
| **规则集**（RuleSet） | 1.0.x 中的"分类"，改称规则集。由手工规则和若干来源组成，可以单独发布为 YAML / LIST / TXT / JSON 订阅。 |
| **规则来源**（Source） | 远程订阅 URL、GeoSite、GeoIP。按来源同步，上游更新不覆盖手工规则。 |
| **规则目录**（Catalog） | 可引用规则的索引：自己的规则集、内置的社区规则索引（ACL4SSR、blackmatrix7，仅保存 URL 与元数据）、GeoSite / GeoIP 名称。每个条目带应用分类与默认去向。 |
| **应用组件**（AppCard） | "分应用类型"的基本单位，例如"AI 服务""流媒体"。定义一个策略组：组类型、候选出口、节点筛选器、匹配来源。可复用于多个模板。 |
| **模板**（Template） | 由应用组件组合、排序而成，加上兜底规则、DNS 方案、节点槽位声明和客户端补丁。采用"底稿 + 修改层"结构，带版本记录。**模板不含任何敏感信息**。 |
| **节点槽位**（NodeSlot） | 模板中声明的节点占位，例如"机场 A""自建"。发布时才绑定具体订阅。 |
| **发布**（Publication） | 模板 + 槽位绑定 + 访问控制 + 目标客户端，对外生成订阅地址。 |
| **编译器**（Compiler） | 把模板中间结构按客户端能力矩阵生成具体配置，并给出兼容性提示。 |

---

## 4. 功能范围

### 4.1 1.1.0 范围

| 模块 | 功能 | 1.0.x 已有 |
| --- | --- | --- |
| 认证 | 管理员密码登录、会话、登出；API Key；Telegram Mini App 会话 | 是（重写并修复缺陷） |
| 概览 | 规则集、来源、模板、发布的统计与同步状态；最近错误 | 部分 |
| 规则集 | 新建、编辑、删除、排序；手工规则增删改、批量导入（预览 → 确认）、冲突检测；搜索 | 是 |
| 规则来源 | 远程 URL / GeoSite / GeoIP；同步间隔、User-Agent、精简级别；预览、手动同步 | 是 |
| 规则集订阅 | 每个规则集的访问方式（Token / 公开 / 关闭）；多格式链接 | 是 |
| **规则目录** | 浏览与搜索可引用规则；按应用分类筛选；查看条目内容 | 新增 |
| **应用组件库** | 内置起步组件；fork 与新建；组件编辑（组类型、候选、节点筛选、匹配来源） | 新增 |
| **模板** | 从组件库组合、拖拽排序；兜底与 DNS 方案；节点槽位；客户端补丁；导入 ACL4SSR `.ini` 或 YAML 作为底稿；版本、对比、回滚 | 新增 |
| **模板检查** | 规则遮蔽、调整顺序后的冲突、组引用缺失与循环、空组、客户端不支持项、分层顺序、no-resolve、正则方言 | 新增 |
| **增强模块** | 可开关的配置增强：防 DNS 泄漏、阻断加密 DNS、IP 规则补 no-resolve、游戏下载直连等（10.12） | 新增 |
| **命中测试** | 输入域名或 IP，显示命中的规则与策略组 | 新增 |
| **发布** | 绑定节点槽位、选择客户端、访问控制、生成订阅地址、实时预览输出 | 新增 |
| 设置 | 基础地址、GitHub 镜像、图标包、规则精简、API Key、Telegram 通知 | 是 |
| 备份 | 导出与导入（先校验、再一次性写入）；格式版本为 `2`（向后兼容导入 `1`），包含规则集、设置、应用组件（`cards`）、模板当前版本（`templates`，不含历史）、发布（`publications`，**不含节点订阅地址与快照**）；导入 1.0.x 备份时仅覆盖规则集与设置，保留已有模板与自定义组件（**已定**） | 是（修复） |
| 通知 | Telegram Bot 同步失败与摘要通知 | 是 |
| PWA | 安装引导、离线外壳 | 是 |
| 多语言 | 简体中文、繁体中文、English | 是（重写机制） |

### 4.2 1.1.0 支持的客户端

| 客户端 | 规则集订阅 | 模板配置 | 节点接入类别（第 11 节） |
| --- | --- | --- | --- |
| mihomo 系（Clash Verge Rev、FlClash、Clash Party 等） | 是 | 是 | A |
| Stash | 是 | 是 | A |
| Surge（iOS / Mac） | 是 | 是 | A |
| sing-box（官方） | 是 | 是 | B |
| Loon | 是 | 是 | C |
| Quantumult X | 是 | 是 | C |
| Shadowrocket | 是 | 是 | C |
| Egern、Surfboard | 是 | 1.2.0 | — |

### 4.3 后续版本（暂定）

| 版本 | 内容 |
| --- | --- |
| 1.2.0 | Egern / Surfboard 模板编译；MRS / SRS 二进制规则集输出；导出为 subconverter `.ini`；规则集变更历史 |
| 1.3.0 | 模板分享（导出不含敏感信息的模板包）；社区模板导入；Tailscale 内网写入配置 |
| 待定 | 规则命中统计（需客户端日志）；只读访客账号 |

---

## 5. 总体架构

### 5.1 分层

```
┌──────────────────────────────────────────────────────────────────────┐
│ web（React SPA / PWA / Telegram Mini App）                            │
│   routes → features → components/ui ── TanStack Query ── API 客户端    │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ HTTPS（JSON，类型由共享 schema 推导）
┌───────────────────────────────┴──────────────────────────────────────┐
│ server（Hono）                                                        │
│   middleware：错误、CORS、鉴权、限流、审计                              │
│   routes：auth / rulesets / sources / catalog / cards / templates /   │
│           publications / subscriptions / settings / backup / telegram │
├──────────────────────────────────────────────────────────────────────┤
│ application（用例）：编排领域逻辑与数据访问，处理事务边界               │
├──────────────────────────────────────────────────────────────────────┤
│ domain（纯函数，无 I/O）                                               │
│   rules：解析、精简、冲突、格式输出                                    │
│   templates：中间结构、检查器、命中测试、编译器、能力矩阵、图标识别     │
│   nodes：订阅解析（基础）                                              │
├──────────────────────────────────────────────────────────────────────┤
│ data：Drizzle schema、repositories、migrations                        │
├──────────────────────────────────────────────────────────────────────┤
│ infrastructure：数据库适配、HTTP 拉取（SSRF 防护）、调度、配置、日志    │
└──────────────┬───────────────────────────────────────┬───────────────┘
               │                                       │
   runtimes/worker.ts（Workers + D1 + Cron）   runtimes/node.ts（Node + SQLite + 调度器）
```

### 5.2 依赖规则

- `domain` 不依赖任何其他层，可以在浏览器与服务端运行（前端用它做预览与检查）。
- `application` 只依赖 `domain` 与 `data` 的接口。
- `server` 只调用 `application`，不直接写 SQL。
- `shared` 中的 zod schema 被前后端共同引用，是接口契约的唯一来源。

### 5.3 部署形态

| 形态 | 运行时 | 数据库 | 定时任务 | 静态资源 |
| --- | --- | --- | --- | --- |
| Cloudflare | Workers | D1 | Cron Triggers | Workers Assets |
| Docker | Node.js 22 LTS | SQLite（WAL） | 进程内调度器 | Node 静态服务 |

两种形态共用同一份代码，差异只在 `runtimes/` 与 `infrastructure/` 的适配器中。

---

## 6. 技术选型

全栈继续使用 **TypeScript**。项目的核心卖点是 Workers 与 Docker 双部署，TypeScript 在两边都是原生运行；前后端共享类型与校验是这次重构的主要收益之一。

### 6.1 前端

| 类别 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | React 19 + Vite | 沿用，迁移成本最低 |
| 路由 | TanStack Router | 类型安全的 URL 驱动路由；按路由拆包 |
| 服务端状态 | TanStack Query | 请求去重、缓存、乐观更新、失效刷新 |
| API 客户端 | Hono RPC（`hc`） | 后端路由类型直接推导到前端 |
| 样式 | Tailwind CSS v4 + CSS 变量设计 token | 主题集中定义，替代手写 CSS |
| 组件 | shadcn/ui（Radix 原语，代码复制进项目） | 无障碍的对话框、抽屉、菜单；样式可完全定制 |
| 表单 | react-hook-form + zod | 校验规则与后端共用 |
| 拖拽排序 | dnd-kit | 模板规则排序；支持键盘与触摸 |
| 代码编辑 | CodeMirror 6 | 客户端补丁与配置预览的高亮、折叠 |
| 多语言 | 带类型的文案字典；繁体在构建时由 OpenCC 生成 | 去掉运行时 DOM 改写与 1.09MB 转换包 |
| 动效 | Motion | 克制使用，遵循"减少动态效果"系统设置 |
| 图标 | lucide-react | 统一线条图标 |

### 6.2 后端

| 类别 | 选型 | 理由 |
| --- | --- | --- |
| Web 框架 | Hono | 在 Workers 与 Node 上原生运行，沿用 |
| 数据访问 | Drizzle ORM + drizzle-kit | 同时支持 D1 与 better-sqlite3；表结构单一来源；类型化查询 |
| 校验 | zod + `@hono/zod-validator` | 所有接口输入校验，schema 与前端共享 |
| YAML | `yaml`（eemeli/yaml） | 解析导入的模板、生成 mihomo / Stash 配置，保留注释与顺序 |
| INI | 自研小型解析器 | ACL4SSR `.ini`（subconverter 格式）字段有限，无需依赖 |
| 日志 | 结构化 JSON 日志（自研薄封装） | Workers 与 Node 统一输出；默认脱敏 |

### 6.3 工程

| 类别 | 选型 |
| --- | --- |
| 包管理 | pnpm 10 |
| 运行时版本 | Node.js 22 LTS（Docker 基础镜像与 CI 固定），同时在 CI 中加跑最新 Node 版本作兼容检查 |
| 单元 / 集成测试 | Vitest |
| 端到端测试 | Playwright（桌面、平板、手机三种视口） |
| 静态检查 | TypeScript strict、ESLint（typescript-eslint）、Prettier |
| CI | GitHub Actions：类型检查、lint、测试、构建、Docker 镜像 |

---

## 7. 目录结构

```
src/
  shared/                     # 前后端共用
    schemas/                  # zod schema：ruleset, source, card, template, publication, settings, backup
    errors.ts                 # 错误代码枚举
    clients.ts                # 客户端标识与显示名
    version.ts
  domain/
    rules/                    # parser, compactor, conflicts, rule-types
    formatters/               # 规则集多格式输出
    templates/
      model.ts                # 中间结构类型
      overlay.ts              # 底稿 + 修改层的合并与重放
      lint/                   # 检查器：shadowing, reorder-diff, references, empty-groups, capability, stages, no-resolve, regex-dialect
      stages.ts               # 规则分层
      modules/                # 增强模块：no-resolve, dns-leak, block-encrypted-dns, game-download, tunnel-direct
      probe.ts                # 命中测试
      planner.ts              # 规则集引用格式与内联规划
      icons.ts                # 策略组图标识别
      importers/              # acl4ssr-ini, mihomo-yaml
      compilers/              # mihomo, stash, surge, singbox, loon, quanx, shadowrocket
      capabilities.ts         # 客户端能力矩阵
    nodes/
      parse.ts                # 订阅基础解析（Base64 URI、Clash YAML）
      filter.ts               # 节点筛选器（地区、正则）
      regions.ts              # 地区识别与按客户端生成正则
  builtin/                    # 内置数据（各自注明来源与许可）：地区词典、规则目录索引、起步组件与模板
  application/                # 用例：rulesets, sources, sync, catalog, cards, templates, publications, backup, auth
  data/
    schema.ts                 # Drizzle 表结构（唯一来源）
    repositories/
    migrations/               # drizzle-kit 生成；0000 为幂等 1.0.x 基线；wrangler.toml 配置 migrations_dir（已定）
  server/
    app.ts                    # 组合
    routes/
    middleware/               # errors, cors, auth, rate-limit, audit
  infrastructure/
    database/                 # d1, sqlite 适配
    http/                     # 带 SSRF 防护的拉取
    scheduler/
    config/
    logging/
  integrations/
    telegram/
  runtimes/
    worker.ts
    node.ts
  web/
    main.tsx
    routes/                   # TanStack 文件路由
    features/
      dashboard/ rulesets/ sources/ catalog/ cards/ templates/ publications/ settings/ auth/
    components/
      ui/                     # shadcn 组件
      layout/                 # AppShell, Sidebar, Topbar, BottomNav
    theme/
      tokens.css              # Miku 设计 token
    i18n/
      zh-CN.ts en.ts          # zh-TW 构建时生成
    lib/
      api.ts                  # hc 客户端、query key
      telegram/
tests/
  unit/ integration/ contract/ e2e/
  fixtures/
    legacy-db/                # 1.0.x 真实数据库样本，用于升级测试
    clients/                  # 各客户端编译输出快照
```

---

## 8. 数据模型

### 8.1 原则

- 表结构只在 `data/schema.ts` 定义，迁移由 drizzle-kit 生成并存放于 `src/data/migrations/`，`wrangler.toml` 配置 `migrations_dir = "src/data/migrations"`（**已定**）。
- 第一条迁移是 **1.0.x 幂等基线**：与 1.0.6/1.0.7 实际表结构一致，兼容已有 `d1_migrations` 或仅经 `ensureDatabase` 建表的历史数据库，检测通过后直接标记为已执行（**已定**）。
- 时间字段统一为 ISO 8601 字符串（与 1.0.x 一致）。
- 写多张表的操作必须在一次 `batch` 中提交（D1 不支持交互式事务，见 20 节）。
- 1.0.x 的表名（如 `categories`）在 1.1.0 中保持不变，只在代码层改称"规则集"，避免迁移风险。

### 8.2 沿用的表（来自 1.0.x）

| 表 | 用途 | 1.1.0 变化 |
| --- | --- | --- |
| `categories` | 规则集 | 无结构变化 |
| `rules` | 规则（手工规则 `source_id` 为空） | 新增 `options` 列（`TEXT(JSON)`，存 `noResolve` 等选项，**已定**）；增加索引 `(category_id, source_id)`、`(type, value)` |
| `category_sources` | 规则来源 | 无结构变化 |
| `source_rule_staging` | 同步暂存 | 无 |
| `sync_leases` | 同步租约 | 无 |
| `settings` | 键值设置 | 无 |
| `sessions` | 管理员会话 | 增加过期清理任务 |
| `api_keys` | API Key | 增加 `scopes` 列（默认 `full`，为后续只读 Key 预留） |
| `icon_pack_cache` | 图标包缓存 | 无 |
| `telegram_*`（11 张） | Telegram 业务 | 无 |
| `telegram_rate_limits` | 限流计数 | 重命名为通用的 `rate_limits`（迁移中复制数据） |

### 8.3 新增的表

**`catalog_entries`**：内置社区规则索引（随版本发布更新，用户不可编辑）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | 例如 `acl4ssr:Ruleset_AI` |
| `provider` | TEXT | `acl4ssr` / `blackmatrix7` / `custom-openclash-rules` |
| `parent_id` | TEXT | 可空；用于层级条目，例如游戏 → 平台与区服 |
| `name` | TEXT | 显示名 |
| `aliases` | TEXT(JSON) | 搜索别名 |
| `category` | TEXT | `ai` / `streaming` / `social` / `gaming` / `advertising` / `domestic` / `infrastructure` / `other` |
| `default_route` | TEXT | `proxy` / `direct` / `reject` |
| `source_url` | TEXT | 原始列表地址 |
| `rule_count` | INTEGER | 可空 |

> 自己的规则集与 GeoSite / GeoIP 在查询时合并进目录，不复制到此表。

**`app_cards`**：应用组件

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | |
| `slug` | TEXT UNIQUE | |
| `name` | TEXT | |
| `icon` | TEXT | emoji 或图标键 |
| `category` | TEXT | 同目录分类 |
| `body` | TEXT(JSON) | 组件定义（zod 校验，结构见 10.2） |
| `origin` | TEXT | `builtin` / `user` / `fork` |
| `forked_from` | TEXT | 可空 |
| `created_at` / `updated_at` | TEXT | |

**`templates`**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | |
| `slug` | TEXT UNIQUE | |
| `name` / `description` | TEXT | |
| `base_kind` | TEXT | `blank` / `acl4ssr-ini` / `mihomo-yaml` / `builtin` |
| `base_source_url` | TEXT | 底稿来源（可空） |
| `base_body` | TEXT(JSON) | 底稿的中间结构 |
| `overlay` | TEXT(JSON) | 修改层（操作列表） |
| `current_version` | INTEGER | |
| `created_at` / `updated_at` | TEXT | |

**`template_versions`**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `template_id` | TEXT | FK → templates，级联删除 |
| `version` | INTEGER | 与 `template_id` 组成主键 |
| `resolved_body` | TEXT(JSON) | 底稿与修改层合并后的完整中间结构 |
| `note` | TEXT | 保存说明 |
| `created_at` | TEXT | |

保留最近 50 个版本，超出的自动清理。

**`publications`**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PK | |
| `slug` | TEXT UNIQUE | 订阅地址中的名称 |
| `template_id` | TEXT | FK → templates |
| `pinned_version` | INTEGER | 可空；为空时跟随模板最新版本 |
| `clients` | TEXT(JSON) | 启用的客户端列表 |
| `access` | TEXT | `token` / `public` / `disabled` |
| `output` | TEXT | 可空；`full` / `minimal`，为空时继承模板默认 `output`（**已定**） |
| `created_at` / `updated_at` | TEXT | |

**`node_bindings`**：发布的节点槽位绑定（敏感）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `publication_id` | TEXT | FK → publications，级联删除 |
| `slot_id` | TEXT | 与 `publication_id` 组成主键 |
| `subscription_url_enc` | TEXT | AES-GCM 加密后的订阅地址 |
| `user_agent` | TEXT | 拉取时使用 |
| `last_fetched_at` / `last_status` / `last_node_count` | | 仅 B 类与预览使用 |

**`node_snapshots`**：B 类客户端的订阅解析缓存

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `publication_id` + `slot_id` | PK | |
| `nodes_enc` | TEXT | 加密后的已解析节点 JSON |
| `fetched_at` | TEXT | |
| `expires_at` | TEXT | 默认 30 分钟 |

### 8.4 加密

- 订阅地址与节点快照使用 AES-GCM 加密，密钥由**环境变量显式配置的 `SESSION_SECRET`** 通过 HKDF 派生（`info = "private-rules/node-bindings"`）。
- **强制前提（已定）**：节点槽位绑定强制要求显式配置 `SESSION_SECRET` 环境变量，**绝不回退到数据库 `settings` 表内的自动生成密钥**；未配置时服务端拒绝绑定（返回 `SESSION_SECRET_REQUIRED`，503），前端禁用该功能并给出配置提示。
- 更换 `SESSION_SECRET` 会导致已绑定的订阅失效，界面需要提示重新填写。
- 备份格式版本为 `2`，包含 `cards`、`templates`（仅当前版本，不含历史）、`publications`，但**不包含 `node_bindings` 与 `node_snapshots`**（**已定**）。

---

## 9. 规则引擎

规则引擎沿用 1.0.x 已验证的逻辑，重构重点是结构和性能。

### 9.1 规则表示

```ts
// 入库规范类型（14 种，已定）：保留 SRC-PORT，新增 DOMAIN-REGEX / PROCESS-NAME / USER-AGENT / URL-REGEX
type RuleType =
  | 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'DOMAIN-REGEX'
  | 'IP-CIDR' | 'SRC-IP-CIDR' | 'IP-ASN' | 'GEOIP' | 'GEOSITE'
  | 'PROCESS-NAME' | 'DST-PORT' | 'SRC-PORT' | 'USER-AGENT' | 'URL-REGEX';

// 导入/输入可额外识别 IP-CIDR6，入库时统一归一为 IP-CIDR
type RuleInputType = RuleType | 'IP-CIDR6';

type Rule = { id: string; type: RuleType; value: string; options?: { noResolve?: boolean }; note?: string; enabled: boolean };
```

> **规则类型与 IPv6 存储约定（已定）**：保留 1.0.x 的 `SRC-PORT`；`rules` 表新增 `options` JSON 列存储 `noResolve` 等选项；IPv6 网段继续以 `IP-CIDR` 入库以保证 1.0.x 升级前后订阅输出字节一致，仅在输出各客户端格式时按地址形态区分，`IP-CIDR6` 仅作为导入/输入时可识别的别名类型并归一为 `IP-CIDR`。

### 9.2 同步

保留 1.0.x 流程：领取租约 → 拉取 → 解析 / 精简 → 分批写入暂存表 → 一次 batch 替换（删除旧规则、复制暂存、清理暂存、更新来源状态）→ 释放租约。改进点：

- 来源拉取统一走 `infrastructure/http`（SSRF 防护、超时、大小上限、禁止重定向）。
- 同一 host 的来源串行拉取，不同 host 并行（上限 4）。
- 同步结果写入结构化日志，失败时通过 Telegram 通知。

### 9.3 冲突检测

- 批量导入时，一次查询取出全部手工规则，在内存中按类型建立索引（精确值哈希表、后缀树、CIDR 区间表），每条新规则 O(log n) 判断，替代 1.0.x 的 N×M 全表扫描。
- 写入使用分批 `batch`（每批 80 条），并在一次请求内完成。

### 9.3.1 覆盖关系去重

参考 Custom_OpenClash_Rules 合并上游时"按域名和 CIDR 覆盖关系去重"的做法，在现有"类型 + 值"精确去重之外增加覆盖去重（多来源合并时默认开启，可在来源设置中关闭）：

- `DOMAIN-SUFFIX,a.com` 覆盖 `DOMAIN,x.a.com` 与 `DOMAIN-SUFFIX,x.a.com`，后者删除；
- `IP-CIDR,10.0.0.0/8` 覆盖 `IP-CIDR,10.1.0.0/16`，后者删除；
- 只在同一去向（同一规则集）内去重，不跨规则集删除，避免改变模板中的分流结果；
- 预览中单独列出"被覆盖而删除"的条数。

### 9.4 规则集订阅输出

- 订阅请求只查询目标规则集的规则（按 `category_id` 索引），不再加载全库。
- 输出带 `ETag`（规则集 `updated_at` + 格式的哈希）与 `Cache-Control: max-age=300`，支持 `If-None-Match` 返回 304。
- Cloudflare 形态额外使用 Cache API 缓存 5 分钟，规则集变更时主动清除。

### 9.5 按行为拆分输出

参考 Custom_OpenClash_Rules"一份 `.list` 来源派生 Domain / IP / Classical 三类产物"的做法，每个规则集在输出时自动按行为拆分：

| 产物 | 内容 | mihomo 引用方式 |
| --- | --- | --- |
| Domain | `DOMAIN`、`DOMAIN-SUFFIX`（输出为 `+.a.com` 形式） | `behavior: domain`（1.2.0 起可选 MRS） |
| IP | `IP-CIDR`、`IP-CIDR6` | `behavior: ipcidr`，规则写 `no-resolve` |
| Classical | 其余类型（`DOMAIN-KEYWORD`、`DOMAIN-REGEX`、端口、进程、`IP-ASN` 等） | `behavior: classical` |

- 1.0.x 已有 Classical / Domain / IPCIDR 三种 YAML 输出，1.1.0 把"拆分"变为模板编译的默认行为：模板引用一个规则集时，编译器按非空产物生成最多三个 rule-provider，顺序为 Domain → Classical → IP，保证域名类规则先于 IP 类规则匹配。
- 输出确定性：同样的输入总是产生字节相同的输出（稳定排序），便于 ETag、缓存与差异对比。
- 产物头部注释增加 `NAME`、`SOURCE`（后台地址）、`TOTAL`、`UPDATED`。

---

## 10. 模板系统

### 10.1 设计原则

1. **与客户端无关**：模板保存为中间结构，客户端差异全部由编译器处理。
2. **策略组不写节点名**：只写节点筛选器，由各客户端编译为原生写法。
3. **底稿与修改分离**：导入的底稿可以随上游更新，用户的修改作为操作列表重放。
4. **可检查、可预测**：任何会让配置行为变化的编辑都给出提示。
5. **不含敏感信息**：模板可以导出分享，订阅地址只存在发布的绑定里。

### 10.2 中间结构

```ts
// 出口引用
type PolicyRef =
  | { kind: 'builtin'; id: 'DIRECT' | 'REJECT' | 'REJECT-DROP' }
  | { kind: 'card'; cardId: string }            // 另一个应用组件的策略组
  | { kind: 'slot'; slotId: string; filter?: NodeFilter }; // 节点槽位中的节点

// 节点筛选
type NodeFilter = {
  regions?: string[];        // ISO 国家代码，例如 ['HK', 'JP']
  include?: string;          // 名称正则
  exclude?: string;          // 名称正则
};

// 匹配条件（条件树）
type Condition =
  | { op: 'rule'; rule: Rule }
  | { op: 'and' | 'or'; items: Condition[] }
  | { op: 'not'; item: Condition };

// 匹配来源
type Matcher = (
  | { kind: 'ruleset'; ruleSetId: string }                  // 自己的规则集
  | { kind: 'catalog'; entryId: string }                    // 规则目录条目
  | { kind: 'geosite'; name: string }
  | { kind: 'geoip'; name: string; noResolve?: boolean }
  | { kind: 'remote'; url: string; behavior: 'domain' | 'ipcidr' | 'classical'; format?: 'yaml' | 'text' | 'mrs' }
  | { kind: 'inline'; conditions: Condition[] }
) & { updateIntervalSec?: number };                         // 远程规则的更新间隔；自己的规则集默认取来源同步间隔

// 规则分层（10.10）
type Stage = 'pre-direct' | 'app' | 'proxy-fallback' | 'ip' | 'domestic' | 'port' | 'final';

// 应用组件
type AppCard = {
  id: string;
  name: string;
  icon?: string;
  category: CatalogCategory;
  stage: Stage;                       // 新组件加入模板时自动插入对应层
  group: {
    type: 'select' | 'url-test' | 'fallback' | 'load-balance';
    candidates: PolicyRef[];          // 顺序即默认优先级
    test?: { url: string; intervalSec: number; toleranceMs?: number };
  };
  matchers: Matcher[];
  hidden?: boolean;                   // 只作为被引用的基础组，不单独出现在规则中
};

// 模板
type Template = {
  id: string;
  name: string;
  slots: NodeSlot[];                                // 节点槽位声明（11.1）
  regionGroups: RegionGroup[];                      // 地区节点组，例如香港、美国（10.11）
  cards: { cardId: string; enabled: boolean; overrides?: Partial<AppCard> }[]; // 顺序即规则优先级
  groupMode: 'select' | 'fallback';                 // 业务组默认类型（10.4）
  final: PolicyRef;                                 // 兜底（MATCH / FINAL）
  output: 'full' | 'minimal';                       // 默认输出档位，可在发布层覆盖（10.13，已定）
  dns: DnsProfile;                                  // fake-ip / redir-host / 自定义；minimal 档位不输出
  general?: GeneralSettings;                        // 测速地址、跳过代理的主机、IPv6 等
  modules: { id: string; enabled: boolean; params?: Record<string, unknown> }[]; // 增强模块（10.12）
  clientPatches?: Partial<Record<ClientId, string>>;// 原始配置片段，追加或合并到输出
};

type NodeSlot = {
  id: string;
  name: string;
  excludeInfo: boolean;        // 在槽位层统一排除"流量、到期、官网"等非节点条目，默认开启
  udp?: boolean;               // mihomo override.udp
  healthCheck?: { url: string; intervalSec: number };
};

type RegionGroup = {
  id: string;
  name: string;                // 例如 "🇭🇰 香港节点"
  region: string;              // ISO 国家代码，对应内置地区词典
  type: 'url-test' | 'fallback' | 'select' | 'load-balance';
  extraInclude?: string;       // 在词典之外追加的正则
};
```

### 10.3 底稿与修改层

- `base_body`：导入或内置的完整中间结构。
- `overlay`：用户修改的操作列表，例如 `addCard`、`removeCard`、`moveCard`、`setCardOverride`、`setFinal`、`setDns`、`setPatch`。
- 解析结果 = 依次把操作应用到底稿上。
- 上游底稿更新时：
  1. 拉取并解析新底稿；
  2. 重放修改层；
  3. 操作目标已不存在（例如上游删除了某个组）的，标记为冲突，交给用户选择保留、删除或改指向；
  4. 生成新版本前展示与当前版本的差异。

### 10.4 内置起步内容

- **起步组件**约 25 个，覆盖八个分类，例如：AI 服务、YouTube、Netflix、Disney+、哔哩哔哩港澳台、Telegram、X / Twitter、Steam、游戏平台、GitHub、Google、Google FCM、Apple、Microsoft、OneDrive、测速工具、广告拦截、国内直连、局域网直连、漏网之鱼。
- **起步模板**四档，参考 Custom_OpenClash_Rules 的版本划分（结构自行编写，不复制其文件）：

| 档位 | 定位 | 大致组件数 |
| --- | --- | --- |
| 极简 | 只代理 GFW 相关流量，其余直连 | 3 |
| 轻量 | 常用服务，组少、易维护 | 约 12 |
| 标准 | 日常分流与复杂度均衡，默认推荐 | 约 25 |
| 重度 | 业务、地区、用途分组最多 | 约 45 |

- 参考项目用"普通版 / 故障转移版"各维护一份文件（共 8 个模板）。1.1.0 改为模板级开关 `groupMode`：业务组统一使用 `select` 或 `fallback`，不复制模板。切换到 `fallback` 时界面提示：故障转移只检测健康检查地址是否可达，不能判断节点是否能解锁流媒体或 AI 服务。
- 内置内容只引用规则目录与 GeoSite / GeoIP，不打包第三方规则文件。

### 10.5 导入器

| 来源 | 支持内容 |
| --- | --- |
| subconverter `.ini`（ACL4SSR、Custom_OpenClash_Rules 等） | `ruleset=`（含 `clash-domain:` / `clash-classic:` / `clash-ipcidr:` 前缀与末尾的更新间隔）、`[]GEOSITE`、`[]GEOIP`（含 `no-resolve`）、`[]FINAL`；`custom_proxy_group=`（反引号分隔，select / url-test / fallback / load-balance，`[]组名` 引用、`.*` 与正则节点筛选、`url`、`interval,,tolerance`）；正则节点组识别为地区组 |
| mihomo YAML | `proxy-groups`、`rules`、`rule-providers`、`dns`；忽略 `proxies`；`include-all` 与 `filter` 转为节点筛选器 |

导入结果作为模板的底稿；无法识别的部分进入客户端补丁并给出提示。

### 10.6 编译器与能力矩阵

编译流程：

```
解析模板（底稿 + 修改层）
  → 展开组件与匹配来源（规则集 / 目录 / Geo / 远程 / 内联）
  → 规划器决定每个规则集的引用方式（远程引用 / 内联 / 自托管转换）
  → 按能力矩阵转换规则与选项，不能表达的跳过并记录
  → 节点接入（第 11 节）
  → 输出文本 + 兼容性报告（支持条数、跳过条数及原因）
```

能力矩阵的主要维度：

| 能力 | mihomo | Stash | Surge | sing-box | Loon | QX | Shadowrocket |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GEOSITE | 是 | 部分 | 否 | 规则集 | 否 | 否 | 否 |
| GEOIP | 是 | 是 | 是 | 规则集 | 是 | 是 | 是 |
| 逻辑规则（AND / OR / NOT） | 是 | 是 | 是 | 是 | 是 | 否 | 是 |
| 远程规则集 | rule-providers | rule-providers | RULE-SET | rule_set | Remote Rule | filter_remote | RULE-SET |
| 内联规则集 | inline provider | inline provider | [Ruleset] | headless | 否 | 否 | 否 |
| 远程节点引用 | proxy-providers | proxy-providers | policy-path | 否 | 客户端 | 客户端 | 客户端 |
| 节点名正则筛选 | filter | filter | policy-regex-filter | 生成时筛选 | NameRegex | server-tag-regex | policy-regex-filter |
| 策略组图标 | icon | icon | 否 | 否 | img-url | img-url | 否 |
| 节点名正则方言 | 支持后行断言等扩展语法（待实测） | 待实测 | ICU | 由服务端 JS 执行 | ICU | 待实测 | 待实测 |
| 组为空时回退 | `empty-fallback` | 待实测 | 否 | 否 | 否 | 否 | 否 |

> 表中具体取值在实现各编译器时以客户端官方文档为准逐项核对，并以快照测试固定。

**无法原生表达时的处理**：

- 客户端不支持 GEOSITE：改为引用 Private Rules 自己生成的同名规则集地址（由 GeoSite 来源同步得到）。
- Loon / QX 会先匹配本地规则再匹配远程列表：规划器把排在本地规则之前的远程列表改为内联，保证优先级与模板一致。
- 逻辑规则在 QX 中无法表达：跳过并在兼容性报告中列出。
- 所有策略组名、节点名在输出前转义，防止节点备注注入规则。

### 10.7 检查器

| 检查 | 级别 | 说明 |
| --- | --- | --- |
| 规则遮蔽 | 警告 | 后面的规则被前面的规则完全覆盖，永远不会生效 |
| 调整顺序的差异 | 提示 | 拖动排序后，列出改走其他组的样例域名 |
| 组引用缺失 | 错误 | 候选出口引用了不存在的组件或槽位 |
| 组循环引用 | 错误 | A 组的候选里有 B，B 的候选里又有 A |
| 空组 | 警告 | 节点筛选后没有节点（需要节点名预览数据） |
| 兜底缺失 | 错误 | 没有设置 `final` |
| 客户端不支持 | 提示 | 逐客户端列出被转换或跳过的规则 |
| 被引用的基础组被禁用 | 错误 | 禁用了其他组依赖的组件 |
| 分层顺序 | 警告 | 组件所在位置违反分层（10.10），例如 IP 层组件排在应用层之前 |
| 子集在后 | 警告 | 较窄的匹配排在包含它的较宽匹配之后，例如 `openai` 在 `category-ai-!cn` 之后、`googlefcm` 在 `google` 之后 |
| IP 规则缺少 no-resolve | 警告 | 排在域名规则之前且未加 `no-resolve` 的 IP 规则会提前触发 DNS 解析，可能造成泄漏和变慢 |
| 正则方言不兼容 | 警告 / 错误 | 地区组或节点筛选的正则使用了目标客户端不支持的语法 |

检查器是纯函数，前端编辑时实时运行，后端保存与发布时再运行一次。

### 10.8 命中测试

- 输入域名、URL 或 IP，按模板规则顺序逐条匹配，返回首个命中的规则、所属组件与最终出口。
- 遇到需要 DNS 解析才能判断的规则（GEOIP、IP-CIDR 对域名、IP-ASN），不猜测结果，标注"可能在此处更早命中"。
- 远程规则集在测试时使用服务端缓存的内容；没有缓存的标注为"未加载"。

### 10.9 图标

- 按"名称自带 emoji → 服务 / 分类 → 地区 → 组的作用 → 组内规则"的顺序识别策略组图标。
- 支持图标的客户端输出 `icon` / `img-url`，图标来自设置中配置的图标包（沿用 1.0.x 的图标包能力）。

### 10.10 规则分层

Custom_OpenClash_Rules 的标准模板有一条清晰的排序逻辑：先处理强制直连，再处理具体应用，然后是 GFW 兜底代理，再到 IP 类规则，最后是国内直连、端口和兜底。1.1.0 把这条逻辑做成模板的固定分层，组件按 `stage` 自动落到对应层，层内可以自由拖动：

| 层 | `stage` | 典型内容 | 说明 |
| --- | --- | --- | --- |
| 1 前置直连 | `pre-direct` | 局域网与私有地址、自定义直连、游戏下载 CDN、BT Tracker | 最先匹配，避免这些流量被后面的应用规则误代理 |
| 2 应用 | `app` | 即时通讯、社交、AI、GitHub、流媒体、苹果、微软、谷歌、游戏平台 | 按"窄在前、宽在后"排列，例如 ChatGPT → AI 服务、Apple TV+ → 苹果、Google FCM → 谷歌 |
| 3 兜底代理 | `proxy-fallback` | 自定义代理、GFW 列表 | 应用层没命中的被墙域名统一走代理 |
| 4 IP | `ip` | Telegram、Twitter、Facebook、Google、Netflix 等的 GEOIP / IP 段 | 全部带 `no-resolve`；放在所有域名规则之后 |
| 5 国内 | `domestic` | GEOSITE cn、GEOIP cn | 域名在前、IP 在后 |
| 6 端口 | `port` | 非标准端口 | 交给单独的组决定直连或跟随兜底 |
| 7 兜底 | `final` | MATCH / FINAL | 每个模板有且只有一条 |

- 拖动可以跨层，但会触发检查器的"分层顺序"警告，而不是阻止，保留高级用户的自由度。
- 导入的模板按匹配来源类型推断各组件的层；推断不出的放在应用层并标记，等待用户确认。

### 10.11 地区节点组

参考项目为香港、美国、日本、新加坡、台湾、韩国各维护一条节点名正则：包含 emoji 国旗、中英文地名、城市名、机场代码，以及避免误匹配的边界写法（例如 `\bHK\b`，以及排除"尼日利亚"之类的 `日`）。1.1.0 的做法：

- **内置地区词典**：以 ISO 国家代码为键，保存旗帜 emoji、中英文名称、主要城市与机场代码、需要排除的易混词。由项目自行维护（数据文件单独放置，独立注明来源与许可）。
- **按客户端生成正则**：同一份词典由编译器生成各客户端可用的正则。目标客户端不支持后行断言等语法时，改用等价的"包含 + 排除"两段筛选；无法等价时给出警告。
- **sing-box 等 B 类客户端**在服务端用 JS 正则筛选，不存在方言问题。
- 地区组类型默认 `url-test`（测速地址、间隔、容差可调），也可以改为 `fallback` 或 `select`。
- 地区组之间不能互相引用，也不能引用包含自己的父组（检查器保证）。

### 10.12 增强模块

参考项目把"防 DNS 泄漏""阻断加密 DNS""IP 规则补 no-resolve"等能力做成可独立启用的 OpenClash 覆写模块，每个模块写明影响范围、冲突和验收要点。这比让用户手写原始补丁可靠得多。1.1.0 把它设计为模板上的**增强模块**：作用在中间结构上的可组合变换，编译前按固定顺序执行。

每个模块声明：

```ts
type EnhancementModule = {
  id: string;
  name: string;
  description: string;
  affects: Array<'dns' | 'rules' | 'groups' | 'final' | 'providers'>;
  conflictsWith?: string[];
  supportedClients: ClientId[];          // 不支持的客户端跳过并写入兼容性报告
  params?: ZodSchema;
  apply(template: ResolvedTemplate, ctx: CompileContext): ResolvedTemplate; // 纯函数
};
```

1.1.0 内置模块（思路参考 Custom_OpenClash_Rules，实现自行编写）：

| 模块 | 作用 | 默认 | 客户端 |
| --- | --- | --- | --- |
| IP 规则补 no-resolve | 为目标 IP 类规则与 `ipcidr` 行为的规则集补充 `no-resolve` | 开 | 支持该选项的全部客户端 |
| 防 DNS 泄漏 | 开启 DNS 规则跟随（mihomo `respect-rules`），移除系统 DNS，兜底改为专用代理组且为空时回退拦截 | 关 | mihomo、sing-box（各自写法） |
| 阻断加密 DNS | 在规则最前面拦截 853 端口与常见 DoH / DoT / DoQ 域名和 IP，迫使终端使用配置中的 DNS | 关 | 全部 |
| 游戏下载直连 | 在前置直连层加入游戏平台下载与 Steam CDN | 关 | 全部 |
| 局域网与内网穿透直连 | Tailscale、Cloudflare Tunnel 等域名、IP、端口直连 | 关 | 全部 |

- 模块产生的规则引用 Private Rules 中对应的规则集；首次启用时，若规则集不存在，引导用户从规则目录创建并同步。
- 启用有冲突的两个模块时，界面阻止保存并说明原因。
- 模块的效果在客户端预览与命中测试中实时可见。

### 10.13 输出档位与导出

**输出档位（已定）**：参考项目的 YAML 只包含节点来源、策略组、规则集和规则，端口、DNS、TUN、嗅探等运行参数全部交给 OpenClash 界面管理。1.1.0 将 `output` 作为**模板默认值**，并允许**每个发布单独覆盖**，使同一套模板可同时服务直接导入客户端与 OpenClash 等场景：

| 档位 | 内容 | 适用 |
| --- | --- | --- |
| `full` | 完整配置：运行参数、DNS、节点接入、策略组、规则 | 直接导入客户端 |
| `minimal` | 只有节点接入、策略组、规则集、规则 | OpenClash、自己管理运行参数的用户 |

**导出为 subconverter `.ini`（1.2.0）**：参考项目同一套设计同时提供订阅转换模板、YAML 和覆写模块三种用法。1.2.0 起增加 `.ini` 编译目标，使 OpenClash 用户可以在其内置的订阅转换中直接使用 Private Rules 的模板地址。导入（10.5）在 1.1.0 已支持。

---

## 11. 节点接入

### 11.1 三类客户端

| 类别 | 客户端 | 节点如何进入配置 | Private Rules 是否解析节点 |
| --- | --- | --- | --- |
| **A. 配置内远程引用** | mihomo 系、Stash、Surge | 节点槽位编译为 `proxy-providers`（mihomo / Stash）或 `policy-path`（Surge），填入绑定的订阅地址，由内核自己拉取、解析 | 否 |
| **B. 节点必须写进配置** | sing-box 官方版本 | 请求订阅时由服务端拉取绑定的订阅，做基础解析，内联为 outbounds | 是（基础解析） |
| **C. 客户端管理节点** | Quantumult X、Loon、Shadowrocket | 配置中不写节点部分，策略组用节点名正则匹配客户端里已有的节点 | 否 |

### 11.2 节点槽位编译示例

**mihomo**

```yaml
proxy-providers:
  slot-airport-a:
    type: http
    url: <绑定的订阅地址>
    interval: 3600
    proxy: DIRECT                      # 拉取订阅本身走直连
    filter: "^(?!.*(流量|到期|官网|剩余|过期|Traffic|Expire)).*$"   # excludeInfo：槽位层统一排除非节点条目
    header:
      User-Agent: [<绑定的 UA>]
    health-check: { enable: true, url: https://cp.cloudflare.com/generate_204, interval: 300 }
    override: { udp: true }
proxy-groups:
  - name: 🇭🇰 香港
    type: url-test
    use: [slot-airport-a]
    filter: "(?i)港|hk|hong ?kong"
```

**Surge**

```ini
[Proxy Group]
🇭🇰 香港 = url-test, policy-path=<绑定的订阅地址>, policy-regex-filter=(?i)港|hk|hong ?kong, update-interval=3600
```

**Quantumult X**（节点在客户端中添加）

```ini
[policy]
url-latency-benchmark=🇭🇰 香港, server-tag-regex=(?i)港|hk|hong ?kong, check-interval=300
```

### 11.3 B 类基础解析

- 支持的订阅格式：Base64 编码的分享链接列表、Clash YAML（`proxies:`）。
- 支持的协议：Shadowsocks、VMess、VLESS（含 Reality）、Trojan、Hysteria2、TUIC。
- 不支持的节点跳过，兼容性报告显示跳过数量与协议。
- 解析结果加密缓存 30 分钟；拉取失败时使用上次成功的结果，并在发布页显示状态。
- 支持为每个槽位设置 User-Agent。

### 11.4 节点名预览（可选）

- 在发布页可以手动"拉取节点名"，用于预览地区分组和检查空组。
- 只保存节点名列表（加密），不保存节点参数；A / C 类客户端的输出不使用这份数据。

### 11.5 待验证（不阻塞 M1–M4）

- 在 QX、Loon 中导入完整配置，是否会覆盖客户端中已添加的订阅。如果会覆盖，这两个客户端额外提供"仅规则资源"输出：QX 使用 `filter_remote` 规则列表，Loon 使用远程规则或插件，只更新规则部分。
- sing-box 最新官方版本是否已提供远程节点引用能力；如果已提供，sing-box 改为 A 类。
- **已定与待定项（不阻塞 M1–M4）**：`sing-box` 最低目标官方版本号已确认为 **1.12**（采用 1.12 新版 DNS 与 `route.rule_set` / `route.rules` action 语法）；M4/M5 真机实测客户端清单进入真机联调前最终确认。

---

## 12. API 设计

### 12.1 约定

- 前缀 `/api`，JSON 请求与响应；输入用 zod 校验，校验失败返回 400 与字段级错误。
- 统一错误结构（**已定**，沿用 1.0.x 兼容扁平格式）：`{ "ok": false, "error": "...", "code": "RULESET_NOT_FOUND", "details": {} }`；前端按 `code` 显示本地化文案，保留字符串 `error` 兼容 1.0.x 客户端。
- 鉴权方式：会话 Cookie、`Authorization: Bearer prk_...`（API Key）、Telegram Mini App 会话。
- 写操作的接口在 Telegram 会话下记录审计日志（沿用 1.0.x）。
- 列表接口支持 `?q=`、`?cursor=`、`?limit=`（上限 200）。

### 12.2 路由

| 资源 | 路由 | 说明 |
| --- | --- | --- |
| 健康检查 | `GET /health` | 数据库状态、运行时、版本 |
| 认证 | `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me` | 登录限流：同一身份 15 分钟内 10 次 |
| Telegram 会话 | `POST /api/telegram/session`、`GET /api/telegram/session/me`、`POST /api/telegram/session/logout` | |
| API Key | `GET/POST /api/api-keys`、`PATCH/DELETE /api/api-keys/:id` | 仅会话可用 |
| 规则集 | `GET/POST /api/rulesets`、`GET/PATCH/DELETE /api/rulesets/:id` | |
| 规则 | `GET/POST /api/rulesets/:id/rules`、`PATCH/DELETE /api/rulesets/:id/rules/:ruleId`、`POST /api/rulesets/:id/rules/batch`、`POST /api/rulesets/:id/rules/import` | 导入分预览与确认两步 |
| 来源 | `GET/POST /api/rulesets/:id/sources`、`PATCH/DELETE /api/rulesets/:id/sources/:sourceId`、`POST .../preview`、`POST .../sync` | |
| 同步 | `POST /api/sync`、`POST /api/rulesets/:id/sync` | |
| 规则目录 | `GET /api/catalog`、`GET /api/catalog/:entryId` | 合并内置索引、规则集、Geo 名称 |
| Geo 搜索 | `GET /api/geo/search` | |
| 应用组件 | `GET/POST /api/cards`、`GET/PATCH/DELETE /api/cards/:id`、`POST /api/cards/:id/fork` | |
| 模板 | `GET/POST /api/templates`、`GET/PATCH/DELETE /api/templates/:id`、`POST /api/templates/import`、`POST /api/templates/:id/rebase` | |
| 模板版本 | `GET /api/templates/:id/versions`、`GET /api/templates/:id/versions/:v`、`POST /api/templates/:id/versions/:v/restore` | |
| 模板工具 | `POST /api/templates/:id/lint`、`POST /api/templates/:id/probe`、`POST /api/templates/:id/preview?client=` | |
| 发布 | `GET/POST /api/publications`、`GET/PATCH/DELETE /api/publications/:id`、`PUT /api/publications/:id/slots/:slotId`、`POST /api/publications/:id/slots/:slotId/fetch-names` | 订阅地址只写不读，读取时返回脱敏值 |
| 链接 | `GET /api/links` | 按当前鉴权方式决定是否包含 Token；只返回当前访问方式下有效的地址 |
| 设置 | `GET/PATCH /api/settings` | |
| 备份 | `GET /api/backup`、`POST /api/backup/validate`、`PUT /api/backup` | 导入前必须先通过校验 |
| Telegram Webhook | `POST /api/telegram/webhook` | |

1.0.x 的 `/api/categories` 等路由保留为兼容别名，1.1.x 期间不移除。

### 12.3 公开订阅地址

| 地址 | 说明 |
| --- | --- |
| `/rules/:file` | 规则集公开订阅（沿用） |
| `/sub/:token/:file` | 规则集 Token 订阅（沿用） |
| `/p/:slug/:file` | 模板发布的公开订阅（新增） |
| `/t/:token/:slug/:file` | 模板发布的 Token 订阅（新增） |

`:file` 仅由文件名本身决定客户端（不再重复包含 `:slug`，**已定**），固定映射如下：`mihomo.yaml`（mihomo）、`stash.yaml`（Stash）、`surge.conf`（Surge）、`singbox.json`（sing-box）、`loon.conf`（Loon）、`qx.conf`（Quantumult X）、`shadowrocket.conf`（Shadowrocket），例如 `/p/home/mihomo.yaml`、`/t/<token>/home/surge.conf`。

---

## 13. 前端设计

### 13.1 信息架构

```
概览
规则
  ├─ 规则集（列表 / 详情：手工规则、来源、订阅链接）
  └─ 规则目录
模板
  ├─ 应用组件库
  ├─ 模板（列表 / 编辑器）
  └─ 发布
设置
  ├─ 基础 / 规则精简 / 图标包
  ├─ API Key / Telegram
  └─ 备份与恢复
关于
```

- 桌面：左侧固定侧边栏 + 顶栏；平板：可折叠侧边栏；手机：底部导航（概览、规则、模板、设置）。
- 所有页面状态都在 URL 中，刷新与分享链接后保持一致。

### 13.2 模板编辑器布局（桌面）

```
┌──────────────┬──────────────────────────────┬──────────────────────┐
│ 应用组件库    │ 模板（拖拽排序）               │ 右侧面板（标签页）     │
│ 按分类筛选    │ ① AI 服务        → 🇺🇸 美国   │ · 检查结果            │
│ 搜索          │ ② YouTube        → 🚀 选择    │ · 命中测试            │
│ [拖入模板]    │ ③ 国内直连       → DIRECT     │ · 客户端预览           │
│              │ …                             │   (mihomo/Surge/...)  │
│              │ 兜底：🐟 漏网之鱼              │ · 版本与差异           │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

手机上三栏改为分步页面：组件列表 → 模板顺序 → 检查与预览。

### 13.3 Miku 设计系统

**颜色 token**（深色为默认，与 README 横幅一致）：

| token | 深色 | 浅色 | 用途 |
| --- | --- | --- | --- |
| `--primary` | `#39C5BB` | `#137A7F` | 主按钮、选中态、链接 |
| `--primary-foreground` | `#06201E` | `#FFFFFF` | 主色上的文字 |
| `--accent` | `#E12885` | `#C8186F` | 少量强调（徽标、关键提示） |
| `--bg` | `#0B1418` | `#F5FAFA` | 页面背景 |
| `--surface` | `#122027` | `#FFFFFF` | 卡片 |
| `--surface-muted` | `#182A33` | `#EEF5F5` | 次级区域 |
| `--border` | `#1F3540` | `#D5E6E6` | 分割线 |
| `--text` | `#E8F4F4` | `#10232A` | 正文 |
| `--text-muted` | `#8FA9B0` | `#5A7178` | 次要文字 |
| `--success` / `--warning` / `--danger` | `#3DD68C` / `#F5B93D` / `#FF6B7A` | `#16A35A` / `#B7791F` / `#D92D3B` | 状态 |
| `--glow` | `rgba(57,197,187,.35)` | — | 横幅风格的青色光晕，仅用于主按钮悬停与关键卡片 |

- 所有前景 / 背景组合满足 WCAG AA（正文对比度 ≥ 4.5:1），在实现阶段用工具逐项校验。
- 圆角：8 / 12 / 16 / 24px；阴影三档；间距 4px 基准。
- 字体：系统字体栈（`-apple-system, "PingFang SC", "Noto Sans SC", system-ui`），等宽字体用于规则与配置预览。

**视觉素材**：

- 登录页背景、空状态插画、关于页使用 Miku 风格素材；头像与背景压缩为 WebP，单张 ≤ 150KB。**开发期（已定）**先使用与 `assets/banner.webp` 同风格的占位图推进，正式发布前替换定稿。
- 初音未来形象受 Crypton Future Media 的 Piapro 角色许可约束；个人非商业的自托管项目可以使用，素材来源与许可写入 `THIRD-PARTY-NOTICES.md`。

**动效原则**：

- 只用于反馈与方位（展开、拖拽落位、对话框出入），时长 150–250ms。
- 不对页面内容做模糊进入；系统开启"减少动态效果"时只保留透明度变化。

### 13.4 状态管理

| 状态 | 位置 |
| --- | --- |
| 服务端数据 | TanStack Query，按资源划分 query key；变更后精确失效相关 key |
| 页面状态（当前视图、筛选、选中项） | URL search params（TanStack Router 类型化） |
| 表单 | react-hook-form |
| 模板编辑草稿 | 编辑器内部状态 + 本地自动保存（IndexedDB），显式"保存为新版本" |
| 主题、语言 | localStorage + `<html data-theme>` / `lang` |

### 13.5 多语言

- 文案字典以简体中文为源，`zh-CN.ts` 与 `en.ts` 手写；`zh-TW.ts` 在构建时由 OpenCC 从简体生成，再叠加少量人工修正表。
- 文案键有类型约束，缺失翻译在构建时报错。
- 后端错误按 `code` 映射到文案，不直接显示服务端中文消息。

### 13.6 性能预算

| 指标 | 目标 |
| --- | --- |
| 首屏 JS（gzip） | ≤ 120KB（含 React） |
| 每个路由增量 JS（gzip） | ≤ 60KB；模板编辑器（含 CodeMirror、dnd-kit）≤ 150KB，按需加载 |
| CSS（gzip） | ≤ 25KB |
| 首次内容绘制（本地网络） | ≤ 1s |
| 页面切换到内容可见 | ≤ 200ms（数据已缓存时） |

### 13.7 Telegram Mini App

- 复用同一个 SPA，读取 Telegram 主题变量映射到 Miku token：保留 `--primary` 为 Miku 青，背景与文字跟随 Telegram。
- 在 Mini App 中隐藏 API Key、备份恢复等高风险操作（沿用 1.0.x 的写权限限制）。

---

## 14. 安全设计

| 项目 | 措施 |
| --- | --- |
| 管理员密码 | 常量时间比较；登录限流（同一身份 15 分钟 10 次，超出锁定 15 分钟）；失败事件写日志并可通过 Telegram 告警 |
| 会话 | HMAC 签名 Cookie（`HttpOnly`、`SameSite=Lax`、HTTPS 下 `Secure`），签名常量时间比较；过期会话定时清理 |
| CSRF（已定） | Cookie 会话的写操作强制校验 `Content-Type: application/json` 且 `Origin` 与 `BASE_URL` 或请求 host 同源（不通过返回 `CSRF_REJECTED`，403）；`Authorization: Bearer prk_...` 的 API Key 请求豁免 `Origin` 检查 |
| CORS（已定） | `/api/*` 取消 `Access-Control-Allow-Origin: *`（仅同源访问）；仅公开订阅路由（`/rules/*`、`/sub/*`、`/p/*`、`/t/*`）保留 `Access-Control-Allow-Origin: *` |
| API Key | 只保存 SHA-256 哈希；预留 `scopes`；API Key 调用方不返回 `RULE_TOKEN` |
| 订阅 Token | 常量时间比较；`RULE_TOKEN` 只在会话鉴权的响应中返回 |
| 节点订阅地址（已定） | AES-GCM 加密存储，强制要求环境变量显式配置 `SESSION_SECRET`（不回退库内密钥，未配置时禁用节点绑定）；只写不读，界面显示脱敏值；不进日志、不进备份、不放进 URL 参数 |
| 含节点的发布（已定） | A 类客户端配置需包含节点订阅明文（`proxy-providers.url`），因此凡存在任意节点绑定的发布，访问方式仅允许 `token` 或 `disabled`：将已绑定节点的发布改为 `public`、或给 `public` 发布绑定节点，均返回 `400 VALIDATION_FAILED` 并给出明确提示；`/p/:slug/:file` 投递前再做防御性校验，若存在节点绑定则直接返回 `404`（不泄露原因）并记录不含 URL 的 `warn` 日志 |
| 客户端 IP | 只有 `TRUST_PROXY=true` 时才信任 `x-forwarded-for`；Cloudflare 形态使用 `cf-connecting-ip` |
| 远程拉取 | 统一 SSRF 防护：禁止内网与保留地址、禁止重定向、超时 15s、大小上限 20MB |
| 配置注入 | 编译输出前转义策略组名、节点名、备注 |
| 备份导入 | zod 完整校验 → 预览差异 → 一次 batch 写入；失败不改变现有数据 |
| 错误信息 | 对外只返回错误代码与通用描述，内部细节写入带关联编号的日志 |
| 依赖 | CI 中运行依赖漏洞扫描；锁定版本 |

---

## 15. 性能与缓存

| 场景 | 策略 |
| --- | --- |
| 规则集订阅 | 按规则集查询 + ETag / 304 + 5 分钟缓存（Cloudflare 使用 Cache API） |
| 模板发布订阅 | 编译结果按 `模板解析版本 + 引用规则集的 updated_at + 客户端 + 节点快照时间` 计算缓存键，缓存 5 分钟；任一输入变化即失效 |
| B 类节点 | 订阅解析结果缓存 30 分钟，失败时使用上次结果 |
| 后台列表 | 规则集列表只返回统计与前 N 条上游规则预览（沿用 1.0.x 思路），完整列表按需分页加载 |
| 批量导入 | 内存索引冲突检测 + 分批 batch 写入 |
| Workers CPU | 编译与冲突检测都是线性或 O(n log n)；单次请求规则总量超过 5 万条时给出提示，建议改用远程引用 |

---

## 16. 测试策略

| 层级 | 内容 | 工具 |
| --- | --- | --- |
| 领域单元测试 | 解析、精简、冲突、格式输出、修改层重放、检查器、命中测试、节点解析 | Vitest |
| 编译器快照测试 | 每个客户端 × 每个起步模板的输出快照；能力矩阵中每一格至少一个用例 | Vitest 快照 |
| 内核校验 | 参考 Custom_OpenClash_Rules 在 CI 中用 mihomo 校验产物的做法：CI 下载固定版本的 mihomo 与 sing-box，对每个起步模板的编译结果分别执行 `mihomo -t` 与 `sing-box check`；规则集输出也用 mihomo 加载一次 | GitHub Actions |
| 增强模块测试 | 每个模块的输入 / 输出用例；模块组合与冲突检测 | Vitest |
| 契约测试 | 同一套用例分别在 D1（Miniflare）与 SQLite 上运行，保证两种数据库行为一致 | Vitest + Miniflare |
| 接口集成测试 | 鉴权、限流、校验、错误代码、备份导入的失败回滚 | Vitest |
| 升级测试 | 用 `tests/fixtures/legacy-db/` 中的 1.0.x 数据库执行迁移，校验数据与订阅输出一致 | Vitest |
| 端到端测试 | 登录、规则集管理、来源同步、模板编辑与发布、主题与语言切换；桌面 / 平板 / 手机三个视口 | Playwright |
| 客户端实测 | 每个客户端导入发布的配置，确认可加载、分流正确（发布前人工清单） | 人工 |

缺陷修复要求：先写能复现缺陷的失败测试，再修复。

---

## 17. 兼容与迁移

### 17.1 必须保持不变

- 规则集订阅地址：`/rules/:file`、`/sub/:token/:file` 及全部文件名格式。
- 环境变量：`ADMIN_PASSWORD`、`SESSION_SECRET`、`RULE_TOKEN`、`BASE_URL`、`DATABASE_PATH`、`HOST`、`PORT`、`TRUST_PROXY`、`SCHEDULER_ENABLED`、`SCHEDULER_INTERVAL_SECONDS`、`LOG_LEVEL`、`TELEGRAM_*`。
- Docker 镜像名与数据卷路径；`wrangler.toml` 中的 D1 绑定名。
- 1.0.x 的备份 JSON（格式版本 `1`）可以无损导入 1.1.0；导入 1.0.x 备份时**只覆盖规则集与设置，保留当前已有的模板与自定义组件**（**已定**）。

### 17.2 数据库升级（已定）

1. 迁移文件统一存放于 `src/data/migrations/`，`wrangler.toml` 配置 `migrations_dir = "src/data/migrations"`。
2. D1 形态继续由 Worker 首次请求自动执行检测与升级（基线迁移保持幂等，同时兼容已存在 `d1_migrations` 与仅靠 `ensureDatabase` 建表的两种 1.0.x 历史状态）；`wrangler d1 migrations apply` 作为可选手动方式保留。
3. 首次启动 1.1.0 时检测迁移记录表；未记录 1.1.0 基线时校验现有表结构与基线一致（容忍 1.0.x 运行时 ALTER 产生的列顺序差异）。
4. 自动备份数据库文件（Docker 形态复制为 `private-rules.db.bak-1.0.x`；D1 形态在文档中提示升级前先执行 `wrangler d1 export`）。
5. 标记基线迁移为已执行，再执行 1.1.0 的新增迁移。
6. 删除 `ensureDatabase` 中的运行时建表与 ALTER 逻辑。

### 17.3 前端切换（已定）

1.1.0 发布时直接替换为新前端，不提供旧界面切换入口。开发期间新前端挂独立入口与旧前端并存便于对照，至 M3.3 对齐验收完成后统一切换。

---

## 18. 版本与发布

| 版本 | 内容 | 分支 |
| --- | --- | --- |
| 1.0.7 | 仅修复 P0 缺陷与 Node 新版本兼容问题，保护现有用户；不改界面 | `main` |
| 1.1.0-alpha.N | 重构进行中的内部预览（Docker `alpha` 标签） | `release/1.1.0` |
| 1.1.0-beta.N | 功能完成，公开测试；附升级指南 | `release/1.1.0` |
| 1.1.0 | 正式发布 | 合并回 `main` |

- 版本号遵循语义化版本；`APP_VERSION` 只在 `src/shared/version.ts` 定义，前后端与 Docker 标签共用。
- 每个版本在 `docs/` 中附发布说明（沿用 `docs/1.0.6.md` 的形式）。

---

## 19. 里程碑与工作量

工作量以熟练开发者的人日计。由 Claude 编写、你审阅时，以"工作会话"推进，每个里程碑结束时你在本地或 alpha 镜像上验收。

| 里程碑 | 内容 | 人日 | 验收标准 |
| --- | --- | --- | --- |
| **M0 准备** | 1.0.7 修复 P0 并发布；建立 `release/1.1.0` 分支、目录骨架、CI、ESLint / Prettier、共享 schema 基础 | 2–3 | 1.0.7 发布；骨架可构建，CI 通过 |
| **M1 数据与后端** | Drizzle schema 与基线迁移、升级测试、repositories；规则集 / 来源 / 同步 / 订阅 / 设置 / 备份 / 认证接口；错误代码、限流、安全措施；性能改进 | 5–7 | 契约与集成测试通过；1.0.x 数据库升级后订阅输出一致 |
| **M2 前端地基** | Miku 设计 token 与 shadcn 组件；布局（侧边栏、顶栏、底部导航）；路由、Query、API 客户端；多语言；登录页 | 3–4 | 三种视口布局正确；主题与语言切换正常 |
| **M3 规则功能对齐** | 概览、规则集（手工规则、批量导入、来源、订阅链接）、设置、备份、PWA、Telegram Mini App | 5–7 | 1.0.x 全部功能可用；e2e 通过 |
| **M4 模板核心** | 中间结构、修改层、规则分层、地区词典与地区组、规则目录、应用组件库与四档起步模板、模板编辑器（拖拽、检查、命中测试、版本）、导入器、增强模块、输出档位、mihomo 编译器、按行为拆分输出与覆盖去重、发布与 A 类节点接入、CI 内核校验 | 11–15 | 用起步模板发布的 mihomo 配置通过 `mihomo -t`，并在客户端正常使用 |
| **M5 多客户端** | Stash、Surge、sing-box（含 B 类基础解析）、Loon、QX、Shadowrocket 编译器；兼容性报告；C 类客户端实测与"仅规则资源"输出 | 8–10 | 每个客户端快照测试通过并完成实测 |
| **M6 发布** | 性能预算达标、文档与升级指南、Docker 镜像、1.1.0-beta 公测与修复 | 2–3 | 1.1.0 正式发布 |
| **合计** | | **36–49** | |

预计 16–24 个工作会话。模板编辑器与各客户端编译器最需要你参与审阅与实测。

---

## 20. 风险与待验证项

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| D1 不支持交互式事务 | 多表写入可能部分成功 | 数据访问层一律使用 `batch`；需要条件判断的写入拆为"校验 → 单次 batch" |
| 1.0.x 数据库的实际表结构有差异 | 升级失败 | 收集多个真实数据库样本做升级测试；校验时容忍列顺序差异；升级前自动备份 |
| 客户端语法差异大、文档不全 | 输出配置无法加载或分流不符 | 每个编译器以快照测试固定，并在真机客户端实测；能力矩阵以实测结果为准 |
| QX / Loon 导入完整配置覆盖客户端订阅 | 用户节点丢失 | M5 开始前实测；必要时只提供"仅规则资源"输出 |
| sing-box 节点协议多、字段变动快 | 部分节点无法使用 | 只覆盖六种常见协议；不支持的跳过并提示；跟随 sing-box 版本更新；最低支持官方版本号已确认为 **1.12**（编译器按 1.12 新语法输出），真机实测客户端清单进入真机联调前确认 |
| Workers CPU 时间限制 | 大模板编译超时 | 编译结果缓存；规则集优先远程引用而不是内联；超大规模给出提示 |
| 第三方规则与素材许可 | 合规风险 | 社区规则只按 URL 引用，不打包；Miku 素材注明来源与许可；参考项目代码只借鉴思路，MIT 许可的 Tower 逻辑移植时注明出处；Custom_OpenClash_Rules 为 CC BY-SA 4.0，其规则文件、模板、地区正则不复制进项目，只按 URL 引用或由用户在运行时自行导入 |
| 正则方言差异 | 地区组在部分客户端匹配不到节点 | 词典按客户端生成正则；检查器报告不兼容语法；客户端实测 |
| 范围膨胀 | 工期失控 | 1.1.0 范围以第 4 节为准；新想法进入 1.2.0 以后的待办 |

---

## 21. 附录

### 21.1 参考项目

| 项目 | 许可 | 借鉴内容 |
| --- | --- | --- |
| [iluobei/miaomiaowu](https://github.com/iluobei/miaomiaowu) / [miaomiaowuX](https://github.com/iluobei/miaomiaowuX) | 未声明 | 只借鉴思路：应用分组目录与预设档位；不复制代码 |
| [pengchujin/tower](https://github.com/pengchujin/tower) | MIT | 分类规则目录、方案与定制层分离、ACL4SSR `.ini` 导入、命中测试、调整顺序冲突检测、规则集引用规划、条件树规则转换、策略组图标识别、名称转义 |
| [Aethersailor/Custom_OpenClash_Rules](https://github.com/Aethersailor/Custom_OpenClash_Rules) | CC BY-SA 4.0 | 规则分层与排序、四档模板与故障转移变体、按行为拆分产物、覆盖去重、槽位层排除非节点条目、地区组设计、覆写模块→增强模块、最小配置档位、CI 内核校验；规则目录条目（仅 URL 与元数据）。详见 21.2 |
| [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) | 以仓库声明为准 | 规则目录条目（仅 URL 与元数据） |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | 以仓库声明为准 | 规则目录条目（仅 URL 与元数据） |

### 21.2 Custom_OpenClash_Rules 分析

**项目概况**：面向 OpenClash（OpenWrt 上的 mihomo 前端）的配置资源仓库，约 6.9k star，CC BY-SA 4.0。包含订阅转换模板（`cfg/*.ini`）、等价的 YAML 配置（`cfg/yaml/`）、远程覆写模块（`overwrite/`）、自维护规则（`rule/`）、按游戏与区服划分的规则（`rule/game_rule/`）、生成与校验脚本（`py/`、`.github/workflows/`）以及 Wiki。

**值得吸收的设计**：

| 参考项目的做法 | 解决的问题 | 1.1.0 对应设计 |
| --- | --- | --- |
| 固定的规则排序：私有地址 → 自定义直连 / 代理 → 游戏 CDN → 具体应用（窄在前）→ GFW → IP 类（全部 `no-resolve`）→ 国内域名 → 国内 IP → 非标端口 → 兜底 | 顺序决定分流结果，且域名规则先于 IP 规则可避免提前解析 | 10.10 规则分层，检查器"分层顺序""子集在后"两项 |
| 四档模板 × 普通 / 故障转移，共 8 个文件 | 不同用户对复杂度要求不同 | 10.4 四档起步模板；故障转移改为模板级开关，不复制文件 |
| 一份 `.list` 源派生 Domain / IP / Classical 产物与 MRS，派生文件不手改 | 让内核用最高效的 behavior 匹配 | 9.5 按行为拆分输出；MRS 列入 1.2.0 |
| 合并上游时按域名后缀与 CIDR 覆盖关系去重 | 规则冗余 | 9.3.1 覆盖关系去重 |
| 在 proxy-provider 层用一条 `filter` 排除公告、流量、到期等非节点条目 | 每个策略组重复写排除规则 | `NodeSlot.excludeInfo`（10.2、11.2） |
| 精细的地区节点正则（旗帜、中英文、城市、机场代码、边界与排除写法） | 机场节点命名五花八门 | 10.11 内置地区词典，按客户端生成正则 |
| 单功能覆写模块，写明影响范围、冲突与验收要点 | 用户手改配置容易出错 | 10.12 增强模块 |
| YAML 只含节点、策略组、规则集、规则，运行参数交给 OpenClash | 模板与设备设置解耦 | 10.13 `minimal` 输出档位 |
| 同一设计同时提供订阅转换、YAML、覆写模块三种用法 | 适配不同使用路径 | 1.1.0 支持导入 `.ini`；1.2.0 支持导出 `.ini` |
| 不同规则集用不同更新间隔（自定义直连 1800 秒，其余 28800 秒） | 常变的规则更快生效 | `Matcher.updateIntervalSec` |
| CI 中用 mihomo 生成 MRS 并校验产物 | 产物能否被内核加载 | 16 节"内核校验" |

**不照搬的部分**：

| 做法 | 原因 |
| --- | --- |
| 只面向 OpenClash / mihomo | Private Rules 面向多客户端，规则分层与增强模块需要按能力矩阵转换 |
| 覆写模块用 Ruby 表达式修改最终 YAML | 难读、难测；1.1.0 在中间结构上做纯函数变换，可单测、可预览 |
| 每个模板文件独立维护、普通版与故障转移版重复 | 改为组件复用加模板级开关，减少重复 |
| 依赖在线订阅转换后端（订阅地址会发给第三方） | Private Rules 在自己的服务器上编译，订阅地址不外发 |
| 复制其规则文件、模板或地区正则 | CC BY-SA 4.0 要求署名并以相同许可分发；1.1.0 只按 URL 引用其规则（可作为目录条目），用户可在运行时自行导入其模板 |

### 21.3 术语表

| 术语 | 含义 |
| --- | --- |
| 规则集 | 一组规则的集合，可单独发布（1.0.x 称"分类"） |
| 规则来源 | 规则集的上游：远程 URL、GeoSite、GeoIP |
| 规则目录 | 可被应用组件引用的规则索引 |
| 应用组件 | 一个按应用类型定义的策略组及其匹配规则 |
| 模板 | 应用组件的有序组合，加上兜底、DNS 与节点槽位 |
| 底稿 / 修改层 | 模板的上游基础与用户修改操作列表 |
| 节点槽位 | 模板中的节点占位，发布时绑定订阅 |
| 发布 | 模板 + 槽位绑定 + 访问控制，对外提供订阅地址 |
| 能力矩阵 | 各客户端支持的规则、规则集、节点引用等能力表 |
| 兼容性报告 | 编译时生成的支持与跳过统计 |
