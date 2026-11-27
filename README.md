<div align="center">

# Private Rules

**操作简单、维护方便，随时随地管理并发布属于自己的规则与分流模板订阅。**

<img src="./assets/banner.webp" alt="Private Rules — Miku 主题的电脑、平板与移动端规则管理" width="100%">

[![Release](https://img.shields.io/badge/release-1.1.0--beta.1-18B7B5?style=flat-square)](./docs/1.1.0.md)
[![Docker Pulls](https://img.shields.io/docker/pulls/cyclince/private-rules?style=flat-square&color=252A34)](https://hub.docker.com/r/cyclince/private-rules/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-EA4C89?style=flat-square)](./LICENSE)

[功能概览](#你会得到什么) · [快速开始](#快速开始) · [部署方式](#部署方式对照) · [订阅格式](#订阅格式) · [1.1.0 升级指南](./docs/upgrade-1.1.0.md) · [发布说明](./docs/1.1.0.md) · [本地开发](#本地开发)

</div>

---

## 这是什么

Private Rules 是一个私有、自托管的规则管理、模板编排与订阅发布控制台，支持 **Cloudflare Workers** 和 **Docker Compose** 两种部署方式。

它把自定义规则、远程订阅、GeoSite 与 GeoIP 数据源集中到同一个 Miku 主题后台：既能按规则集输出 YAML、LIST、TXT 与 sing-box JSON 订阅，也能通过**规则目录、应用组件库、可视化模板编辑器与多客户端编译器**，直接发布面向 mihomo、Stash、Surge、sing-box、Loon、Quantumult X 与 Shadowrocket 的分流配置。

所有规则、模板、登录会话与访问策略都保存在你自己的 Cloudflare D1 或 SQLite 数据库中。每个规则集与模板发布都可以独立控制访问权限，节点订阅地址经 AES-256-GCM 加密保存，不外发第三方在线转换服务。

## 为什么需要它

公开规则集很方便，但真正适合自己的分流体系通常来自很多地方：社区维护的规则源、GeoSite / GeoIP、临时添加的域名，以及只属于个人网络环境的端口、IP 与策略组排序。

Private Rules 把这条链路收拢成一个可持续维护的过程：

1. 从远程订阅、GeoSite、GeoIP、内置规则目录或手工输入汇聚规则。
2. 保留来源并进行定时同步、覆盖去重、校验与按行为拆分。
3. 在模板编辑器中按应用分层编排策略组、启用增强模块，并通过 12 项检查与命中测试即时验证。
4. 为每个规则集或发布单独决定访问策略（公开、Token 或停用），按需绑定加密节点槽位。
5. 一键编译并发布面向多客户端的订阅地址，在电脑、平板和手机上使用同一套响应式管理界面。

上游仍然可以持续更新，而最终规则、访问方式、节点订阅和部署环境始终由你控制。

## 你会得到什么

| 能力 | 实际结果 |
| --- | --- |
| 多来源聚合与去重 | 组合远程 YAML / LIST、GeoSite、GeoIP 与手工规则，保留来源追踪并支持覆盖关系去重 |
| 规则目录与组件库 | 内置规则目录索引、按应用分类的可复用组件与四档起步模板，支持修改层（Overlay）与版本回溯 |
| 可视化模板编辑器 | 拖拽调整分层顺序、12 项实时检查、命中测试、5 个增强模块、ACL4SSR `.ini` / mihomo YAML 导入 |
| 多客户端编译发布 | 支持 mihomo、Stash、Surge、sing-box、Loon、Quantumult X、Shadowrocket，`full` / `minimal` 双档位 |
| 独立访问与节点保护 | 规则集与发布分别控制公开 / Token / 停用；节点订阅由 `SESSION_SECRET` 加密存储且仅写不读 |
| Miku 响应式多端后台 | 深浅双色 Token（WCAG AA 对比度），桌面侧栏、平板抽屉、手机底栏，支持 PWA 与 Telegram Mini App |
| 双运行时部署 | Cloudflare Workers + D1 或 Node.js + SQLite，共享同一套代码与数据库迁移 |
| 运维与安全迁移 | 定时同步、ETag / 304 缓存、v2 JSON 备份恢复（兼容 1.0.x）、健康检查与 Telegram 通知 |

## 规则与模板如何流转

```text
远程订阅 / GeoSite / GeoIP / 规则目录 / 手工规则
                      ↓
       来源追踪 · 同步 · 覆盖去重 · 行为拆分
                      ↓
   规则集发布（/rules, /sub）  或  组件编排 → 模板检查 → 发布（/p, /t）
                      ↓
  mihomo · Stash · Surge · sing-box · Loon · Quantumult X · Shadowrocket
```

## 部署方式对照

| 能力 | Cloudflare Workers | Docker Compose |
| --- | --- | --- |
| 运行时 | Cloudflare Workers | Node.js |
| 数据库 | D1（首次请求自动迁移） | SQLite（升级前自动生成 `.bak-1.0.x`） |
| 定时任务 | Cron Trigger | Node Scheduler |
| 静态资源 | Workers Assets | Node Static |
| 持久化 | Cloudflare 托管 | Docker Volume |
| 适用场景 | 低维护、边缘部署 | VPS、NAS、家庭服务器 |

两种运行方式共用同一套前后端能力。选择 Cloudflare 可以降低服务器维护成本；选择 Docker 则可以把应用与数据完整放在自己控制的主机中。

## 快速开始

仓库默认 `docker-compose.yml` 锁定当前稳定版镜像；如需体验 1.1.0 公开测试版，可将镜像标签改为 `cyclince/private-rules:1.1.0-beta.1`（或 `cyclince/private-rules:beta`）。

```bash
mkdir -p private-rules && cd private-rules
curl -fsSLO https://raw.githubusercontent.com/Cyclince/Private-rules/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Cyclince/Private-rules/main/.env.example -o .env
```

编辑 `.env`（推荐用 `openssl rand -hex 32` 生成 `RULE_TOKEN`）：

```dotenv
ADMIN_PASSWORD=请设置独立的高强度后台密码
RULE_TOKEN=请设置随机且不可猜测的订阅令牌
BASE_URL=https://rules.example.com
```

启动并检查状态：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

容器显示 `healthy` 后，访问 `http://服务器地址:5173/admin/login`。

> [!IMPORTANT]
> - `RULE_TOKEN` 用来隐藏私密订阅路径，不代表内容加密。不要提交 `.env`、Cookie、数据库文件或完整私密订阅地址。
> - `SESSION_SECRET` 默认会自动生成并随数据目录持久化（备份时请连同数据目录一起备份）；如需手动指定，见下文「可选环境变量」。

## 部署到 Cloudflare

### 1. Fork 并导入仓库

Fork 本仓库，然后在 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Import a repository**，选择自己的 Fork。

| Cloudflare 构建设置 | 值 |
| --- | --- |
| Production branch | `main`（公测可使用 `release/1.1.0`） |
| Build command | `pnpm build` |
| Deploy command | `pnpm deploy` |
| Root directory | 留空 |

项目通过 `wrangler.toml` 声明静态资源、定时同步任务和名为 `DB` 的 D1 binding（`migrations_dir = "src/data/migrations"`）。首次部署后，Worker 会在首次请求或 Cron 触发时自动执行幂等数据库迁移；如希望手动执行，也可运行 `pnpm db:migrate:remote`。

Cron Trigger 每 5 分钟扫描一次需要执行的任务；每个来源真正的同步频率仍由后台设置的 15 分钟至每天更新间隔决定。

### 2. 配置变量与密钥

在 **Settings → Variables and Secrets** 中添加：

| 变量或 Secret | 用途 | 必需 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 登录管理后台 | 是 |
| `SESSION_SECRET` | 会话签名与节点订阅 AES-256-GCM 加密密钥（留空时自动持久化生成；自定义时推荐 ≥ 32 字符） | 否 |
| `RULE_TOKEN` | 生成私密订阅地址（`/sub/:token/...` 与 `/t/:token/...`） | 使用私密访问或含节点发布时必需 |
| `BASE_URL` | 站点的公网 HTTPS 地址（用于生成链接、CSRF 校验与 Telegram） | 自定义域名或 Telegram 时必需 |
| `TELEGRAM_BOT_TOKEN` | BotFather 提供的 Bot Token | 否 |
| `TELEGRAM_USER_ID` | 唯一允许使用 Bot 的数字用户 ID | 启用 Telegram 时必需 |
| `TELEGRAM_WEBHOOK_SECRET` | 自定义 Telegram Webhook 校验密钥（留空时自动持久化生成） | 否 |

部署完成后访问：

```text
https://<your-worker-domain>/admin/login
```

如果使用自定义域名，请在 Worker 的 **Domains & Routes** 中完成绑定，再在环境变量或后台“设置”中填写相同的站点基础 URL。

### 3. 可选启用 Telegram

通过 BotFather 创建 Bot，填写 `BASE_URL`、`TELEGRAM_BOT_TOKEN` 与 `TELEGRAM_USER_ID`。系统会在启动或首次请求时自动注册命令、Webhook 和 Mini App。

Bot 只接受配置用户的私聊。部署完成后发送 `/start` 即可使用。出于安全隔离，Telegram Mini App 会话不能访问备份、API Key 与基础设施设置。

## 部署到 Docker

Docker 部署使用 Docker Hub 上的多架构镜像（`linux/amd64`、`linux/arm64`），适合 VPS、NAS 与本地服务器。完整的从零部署、数据卷、升级和故障排查见 [Docker Compose 部署指南](./docs/wiki/Docker-Compose-Deployment.md) 与 [1.1.0 升级指南](./docs/upgrade-1.1.0.md)。

### 可选环境变量

以下环境变量均在代码中提供默认值，未写进默认 `docker-compose.yml`（保持与 1.0.x 一致，升级时只需改镜像标签）。如需自定义，可在 `docker-compose.yml` 的 `environment` 或 Cloudflare Worker 的 Variables / Secrets 中按需添加：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 留空时自动生成并持久化 | 会话签名与节点订阅加密密钥；自定义时生产环境需 ≥ 32 字符，更改会使现有会话失效并让已保存的节点订阅需要重填 |
| `LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `SCHEDULER_ENABLED` | `true` | Node / Docker 是否启用内置定时同步与会话清理调度器 |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | Node / Docker 调度器轮询间隔（秒，范围 `1`–`86400`） |
| `TELEGRAM_WEBHOOK_SECRET` | 留空时自动生成并持久化 | 自定义 Telegram Webhook 校验密钥 |
| `DATABASE_PATH` | `/app/data/private-rules.db` | Node / Docker SQLite 数据库文件路径 |
| `HOST` / `PORT` | `0.0.0.0` / `5173` | Node / Docker 监听地址与端口 |
| `TRUST_PROXY` | `true`（Compose） / `false`（裸跑） | 仅在受信任反向代理后设为 `true`，以识别 `X-Forwarded-For` |

### 数据保存与升级

SQLite 数据保存在 `private-rules-data` volume 中。停止或重新创建容器不会删除该 volume；从 1.0.x 升级至 1.1.0 时，启动阶段会自动先创建 `/app/data/private-rules.db.bak-1.0.x` 快照再迁移。升级前仍建议先在管理后台“设置”页面导出完整 JSON 备份。

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 private-rules
```

除非确定要永久删除全部规则数据，否则不要执行 `docker compose down -v`。

### 反向代理

生产环境建议只让 Caddy 或 Nginx 访问应用端口，并通过公网 HTTPS 提供服务。Caddy 示例：

```caddyfile
rules.example.com {
    reverse_proxy 127.0.0.1:5173
}
```

Compose 已启用 `TRUST_PROXY`。不要允许不受信任的上游覆盖 `Host`、`X-Forwarded-For` 或 `X-Forwarded-Proto`，也不要直接把后台端口暴露在公网。

## 使用路径

1. **规则集管理**（`/admin/rulesets`）：从零构建或挂载远程订阅、GeoSite、GeoIP；配置同步周期与覆盖去重，查看预览并按需复制规则集订阅链接。
2. **规则目录与组件库**（`/admin/catalog`、`/admin/cards`）：浏览内置规则源与按应用分类的策略组组件，按需 Fork 定制。
3. **模板编排**（`/admin/templates`）：从四档起步模板开始（或导入 ACL4SSR `.ini` / mihomo YAML），拖拽调整分层顺序、启用增强模块，通过 12 项检查与命中测试确认分流结果。
4. **发布与节点绑定**（`/admin/publications`）：选择模板与输出档位（`full` / `minimal`），按需绑定加密节点槽位，获取多客户端订阅地址与兼容性报告。
5. **备份与恢复**（`/admin/settings`）：导出 `version: 2` JSON 备份（不含节点订阅地址），或校验后无损导入 1.0.x / 1.1.0 备份。

## 安装为 PWA

访问 `https://<你的域名>/pwa-install` 可打开独立的移动端安装引导（无需先登录）：

- Android Chromium 在满足安装条件后会调用系统安装面板；
- iPhone 与 iPad 会显示 Safari“分享 → 添加到主屏幕”的对应步骤；
- Service Worker（`v4`）仅缓存静态外壳资产，严格不缓存 `/api`、`/rules`、`/sub`、`/p`、`/t` 与 `/health`。

## 订阅格式

### 1. 规则集订阅（1.0.x 完全兼容）

公开地址为 `/rules/<文件名>`，私密 Token 地址为 `/sub/<RULE_TOKEN>/<文件名>`：

| 后缀 | 内容与用途 |
| --- | --- |
| `_Classical.yaml` | Mihomo Classical Rule Provider，输出完整 `TYPE,value` |
| `_Domain.yaml` | Mihomo Domain Rule Provider，只输出域名值与 `+.` 后缀匹配 |
| `_IPCIDR.yaml` | Mihomo Classical IP / Port Provider，输出 IP、来源端口与目标端口（自动补 `no-resolve`） |
| `.yaml` | 原有 YAML 地址，继续按 Classical 格式兼容 |
| `.list` / `_loon.list` / `_qx.list` | 通用 / Loon / Quantumult X 规则列表 |
| `.json` | sing-box Source Rule Set |
| `.txt` | 纯值列表，方便脚本继续处理 |

以 `Custom_Direct` 为例：

```text
/rules/Custom_Direct_Classical.yaml
/rules/Custom_Direct_Domain.yaml
/rules/Custom_Direct_IPCIDR.yaml
/sub/<RULE_TOKEN>/Custom_Direct.list
/sub/<RULE_TOKEN>/Custom_Direct.json
```

### 2. 模板发布订阅（1.1.0 新增）

公开地址为 `/p/<slug>/<file>`，私密 Token 地址为 `/t/<RULE_TOKEN>/<slug>/<file>`（含节点绑定的发布仅允许 `/t/...`）：

| 文件名 | 目标客户端 | 节点接入方式 | 说明 |
| --- | --- | --- | --- |
| `mihomo.yaml` | mihomo / Clash Meta | A 类（`proxy-providers`） | 支持 `full` / `minimal` 与规则集远程引用 |
| `stash.yaml` | Stash | A 类（`proxy-providers`） | 适配 Stash 语法与图标 |
| `surge.conf` | Surge | A 类（`policy-path`） | 支持 `policy-regex-filter` 与 `RULE-SET` |
| `singbox.json` | sing-box（1.12+） | B 类（服务端解析内联） | 6 种主流协议加密快照（30 分钟缓存 + 失败降级） |
| `loon.conf` | Loon | C 类（客户端管理节点） | 默认「仅规则资源」；完整配置为实验选项 |
| `qx.conf` | Quantumult X | C 类（客户端管理节点） | 默认 `filter_remote`；完整配置为实验选项 |
| `shadowrocket.conf` | Shadowrocket | C 类（客户端管理节点） | 输出配置且不覆盖客户端已有节点列表 |

## 数据源与同步

- **远程订阅**：支持同时引用多个 YAML、LIST 或纯文本地址，具备统一 SSRF 防护、15 秒超时与 20MB 大小上限。
- **GeoSite**：数据来自 [`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community)。
- **GeoIP**：使用 [`Loyalsoldier/geoip`](https://github.com/Loyalsoldier/geoip) release 分支中的纯文本数据。
- **图标包**：内置来源为 [`Koolson/Qure`](https://github.com/Koolson/Qure)，也支持自定义 JSON 图标包。
- **自动同步**：可按来源配置 15 分钟至每天的更新间隔，也可以随时手动同步。

## 安全说明

- **会话与 CSRF**：后台会话使用 HMAC 签名 `HttpOnly` Cookie；Cookie 会话的写操作强制校验 `Content-Type: application/json` 与同源 `Origin`（API Key 请求豁免 `Origin` 校验）。
- **CORS 隔离**：`/api/*` 仅允许同源访问；仅公开订阅路由（`/rules/*`、`/sub/*`、`/p/*`、`/t/*`）返回 `Access-Control-Allow-Origin: *`。
- **登录限流**：同一身份 15 分钟内失败 10 次将锁定 15 分钟；密码、Token 与会话签名均采用常量时间比较。
- **节点订阅加密**：节点订阅地址使用 `SESSION_SECRET`（未配置时自动生成并随数据持久化）派生的 AES-256-GCM 加密存储，界面仅显示脱敏值，不进日志、URL 参数与备份；凡含节点绑定的发布禁止设为公开访问。
- **Telegram 权限边界**：Bot 只接受 `TELEGRAM_USER_ID` 指定用户的私聊；Mini App 会话禁止访问备份、API Key 与基础设施设置（服务端 `403`）。
- **凭据保护**：不要提交 `.dev.vars`、`.env`、密码、密钥、Token 或生产数据库内容。

## 更新与备份

- **从 1.0.x 升级至 1.1.0**：请先阅读 [1.0.x → 1.1.0 升级指南](./docs/upgrade-1.1.0.md)（Docker 只需修改镜像标签并自动生成 `.bak-1.0.x` 备份；Cloudflare D1 升级前需执行 `wrangler d1 export`，并附完整回滚方案）。
- **版本变更记录**：详见 [1.1.0 发布说明](./docs/1.1.0.md)。
- `/health` 返回结果中的 `version` 可以用来确认当前运行版本。

## 本地开发

需要 Node.js 22 与 pnpm 10；只有调试 Workers 运行时或部署到 Cloudflare 时才需要 Cloudflare 账号。

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

打开 `http://localhost:5173/admin/login`。`.dev.vars` 已被 Git 忽略，请在其中设置本地密码与 `SESSION_SECRET`。

完整质量与体积检查：

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm size
```

## 技术栈

- Cloudflare Workers、Hono、Drizzle ORM 与 D1
- Node.js、Docker Compose 与 SQLite（`better-sqlite3`）
- React 19、TypeScript、Tailwind CSS、TanStack Router / Query 与 Vite
- Cloudflare Cron Triggers 与 Node Scheduler
- Telegram Bot、Webhook 与 Mini App
- Qure Color 与自定义 JSON 图标包

## 许可证与作者

项目基于 [MIT License](./LICENSE) 开源；第三方组件与素材许可说明见仓库内许可声明。

- GitHub：[@Cyclince](https://github.com/Cyclince)
- Telegram：[@chong_redaily](https://t.me/chong_redaily)

> 本项目仅供学习与技术测试使用。请遵守当地法律法规，并对自己的配置、转发内容与访问行为负责。
