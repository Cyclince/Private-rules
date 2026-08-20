<div align="center">

# Private Rules

**操作简单、维护方便，随时随地管理并发布属于自己的规则订阅。**

<img src="./assets/banner.webp" alt="Private Rules — Miku 主题的电脑、平板与移动端规则管理" width="100%">

[![Release](https://img.shields.io/badge/release-1.0.5-18B7B5?style=flat-square)](https://hub.docker.com/r/cyclince/private-rules/tags)
[![Docker Pulls](https://img.shields.io/docker/pulls/cyclince/private-rules?style=flat-square&color=252A34)](https://hub.docker.com/r/cyclince/private-rules)
[![License: MIT](https://img.shields.io/badge/license-MIT-EA4C89?style=flat-square)](./LICENSE)

[功能概览](#你会得到什么) · [快速开始](#快速开始) · [部署方式](#部署方式对照) · [订阅格式](#订阅格式) · [PWA](#安装为-pwa) · [本地开发](#本地开发)

</div>

---

## 这是什么

Private Rules 是一个私有、自托管的规则管理与订阅发布控制台，支持 **Cloudflare Workers** 和 **Docker Compose** 两种部署方式。

它把自定义规则、远程订阅、GeoSite 与 GeoIP 数据源集中到同一个后台：你可以在电脑上完成大量整理，也可以用平板或手机随时查看、同步和维护。系统会保留不同上游的来源关系，自动去重，再按客户端需要生成 YAML、LIST、TXT 与 JSON 订阅。

所有规则、登录会话与访问策略都保存在你自己的 Cloudflare D1 或 SQLite 数据库中。每个规则集可以独立选择私密 Token、公开链接或禁止访问，不必为了分享一条规则而暴露整个规则库。

## 为什么需要它

公开规则集很方便，但真正适合自己的规则通常来自很多地方：常用项目的 YAML、社区维护的 GeoSite、单独下载的 GeoIP、临时添加的域名，以及只属于个人网络环境的端口与 IP。

如果长期依赖手工复制，这些内容很容易重复、失去上游更新，或者在整理时误删自定义条目。更现实的问题是，你可能在电脑上建立规则，却又需要在手机上临时修正；同一份内容还要分别提供给 Clash、Surge、Loon 或 sing-box。

Private Rules 把这条链路收拢成一个可持续维护的过程：

1. 从远程订阅、GeoSite、GeoIP 或手工输入汇聚规则。
2. 保留来源并进行同步、校验与去重。
3. 为每个规则集单独决定访问权限。
4. 自动生成适合不同客户端的订阅地址。
5. 在电脑、平板和手机上使用同一套响应式管理界面。

上游仍然可以持续更新，而最终规则、访问方式和部署环境始终由你控制。

## 你会得到什么

| 能力 | 实际结果 |
| --- | --- |
| 多来源聚合 | 组合远程 YAML / LIST、GeoSite、GeoIP 与自定义规则，并按“类型 + 内容”去重 |
| 来源级同步 | 上游来源彼此独立；编辑来源并删除其中一项后，对应旧规则会被正确清理 |
| 自定义内容保护 | 上游同步保持只读边界，不会覆盖同一规则集中的手工内容 |
| 独立访问控制 | 每条规则分别启用 Token、公开地址或完全关闭订阅 |
| 多格式发布 | 一份规则生成 Classical、Domain、IP / Port、LIST、TXT 与 sing-box JSON |
| 多端管理 | 响应式后台覆盖桌面、平板和手机，并提供 Android / iOS PWA 安装引导 |
| 双运行时部署 | Cloudflare Workers + D1 或 Node.js + SQLite，可按自己的环境选择 |
| 运维与迁移 | 定时同步、手动预览、JSON 备份恢复、健康检查和 Telegram 通知 |

## 规则如何完成一次旅程

在“规则”页面创建分类后，可以从零开始，也可以选择远程订阅、GeoSite 或 GeoIP。每个上游来源单独记录，因此新增、更新和删除来源都能准确反映到同步结果中，而不会把其他来源或自定义内容混在一起。

同步完成后，后台会展示新增、重复与无效内容。确认结果后，前往“订阅”页面选择访问策略并复制目标客户端的链接。同一规则集不需要维护多份文件，格式差异由输出器在请求时完成。

```text
远程订阅 / GeoSite / GeoIP / 手工规则
                  ↓
        来源追踪 · 同步 · 去重
                  ↓
        访问控制 · 多格式输出
                  ↓
   Clash  · Surge · Loon · sing-box
```

## 部署方式对照

| 能力 | Cloudflare Workers | Docker Compose |
| --- | --- | --- |
| 运行时 | Cloudflare Workers | Node.js |
| 数据库 | D1 | SQLite |
| 定时任务 | Cron Trigger | Node Scheduler |
| 静态资源 | Workers Assets | Node Static |
| 持久化 | Cloudflare 托管 | Docker Volume |
| 适用场景 | 低维护、边缘部署 | VPS、NAS、家庭服务器 |

两种运行方式共用同一套前后端能力。选择 Cloudflare 可以降低服务器维护成本；选择 Docker 则可以把应用与数据完整放在自己控制的主机中。

## 快速开始

仓库提供的 Compose 默认锁定稳定版镜像 `cyclince/private-rules:1.0.5`；`cyclince/private-rules:latest` 同时指向这个版本，适合希望自动跟随后续稳定版本的部署。

```bash
mkdir -p private-rules && cd private-rules
curl -fsSLO https://raw.githubusercontent.com/Cyclince/Private-rules/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Cyclince/Private-rules/main/.env.example -o .env
```

编辑 `.env`：

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
> `RULE_TOKEN` 用来隐藏私密订阅路径，不代表内容加密。不要提交 `.env`、Cookie、数据库文件或完整私密订阅地址。

## 部署到 Cloudflare

### 1. Fork 并导入仓库

Fork 本仓库，然后在 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Import a repository**，选择自己的 Fork。

| Cloudflare 构建设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Build command | `pnpm build` |
| Deploy command | `pnpm deploy` |
| Root directory | 留空 |

项目通过 `wrangler.toml` 声明静态资源、定时同步任务和名为 `DB` 的 D1 binding。首次部署后，请在 Worker 的 **Settings → Bindings** 中确认 `DB` 已连接。

首次使用或仓库新增 migration 后执行：

```bash
pnpm db:migrate:remote
```

Cron Trigger 每 5 分钟扫描一次需要执行的任务；每个来源真正的同步频率仍由后台设置的 15 分钟至每天更新间隔决定。

### 2. 配置变量与密钥

在 **Settings → Variables and Secrets** 中添加：

| 变量或 Secret | 用途 | 必需 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 登录管理后台 | 是 |
| `RULE_TOKEN` | 生成私密订阅地址 | 使用私密访问时 |
| `BASE_URL` | 站点的公网 HTTPS 地址 | 自定义域名或 Telegram 时建议 |
| `TELEGRAM_BOT_TOKEN` | BotFather 提供的 Bot Token | 否 |
| `TELEGRAM_USER_ID` | 唯一允许使用 Bot 的数字用户 ID | 否 |

部署完成后访问：

```text
https://<your-worker-domain>/admin/login
```

如果使用自定义域名，请在 Worker 的 **Domains & Routes** 中完成绑定，再在后台“设置”中填写相同的站点基础 URL。

### 3. 可选启用 Telegram

通过 BotFather 创建 Bot，填写 `BASE_URL`、`TELEGRAM_BOT_TOKEN` 与 `TELEGRAM_USER_ID`。Worker 会自动生成并持久化会话密钥与 Webhook 密钥，并在首次请求或 Cron 触发时注册命令、Webhook 和 Mini App。

Bot 只接受配置用户的私聊。部署完成后发送 `/start` 即可使用。

## 部署到 Docker

Docker 部署使用 Docker Hub 上的多架构镜像，适合 VPS、NAS 与本地服务器。完整的从零部署、数据卷、升级和故障排查见 [Docker Compose 部署指南](./docs/wiki/Docker-Compose-Deployment.md)。

### 数据保存与升级

SQLite 数据保存在 `private-rules-data` volume 中。停止或重新创建容器不会删除该 volume；升级前仍建议先在管理后台“设置”页面导出完整 JSON 备份。

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

1. 在“规则”中选择从零构建、远程订阅、GeoSite 或 GeoIP。
2. 配置来源、图标和同步间隔，并按需添加自定义域名、关键词、IP、CIDR 或端口。
3. 执行同步，在批量预览中检查新增、重复和无效内容。
4. 在“订阅”详情中选择当前规则的访问策略，复制目标客户端对应的链接。
5. 在“设置”中导出完整 JSON 备份，或将已有备份恢复到新的运行环境。

电脑适合集中整理大量规则；平板和手机则适合随时查看同步状态、修正规则与复制订阅。所有端共享相同数据，不需要额外建立移动版规则库。

## 安装为 PWA

部署包含 PWA 支持的版本后，访问 `https://<你的域名>/pwa-install` 会打开独立的移动端安装引导。

- Android Chromium 在满足安装条件后会调用系统安装面板。
- iPhone 与 iPad 会显示 Safari“分享 → 添加到主屏幕”的对应步骤。
- 安装完成后，应用以独立窗口启动，仍然使用原有后台登录保护。
- 若设备已经安装，会显示相应状态，避免重复提示。

## 订阅格式

同一个规则集会按文件名选择对应输出器。原有 `.yaml` 地址继续按 Classical 格式工作，新地址则进一步细分用途。

| 后缀 | 内容与用途 |
| --- | --- |
| `_Classical.yaml` | Mihomo Classical Rule Provider，输出完整 `TYPE,value` |
| `_Domain.yaml` | Mihomo Domain Rule Provider，只输出域名值与 `+.` 后缀匹配 |
| `_IPCIDR.yaml` | Mihomo Classical IP / Port Provider，输出 IP、来源端口与目标端口 |
| `.yaml` | 原有 YAML 地址，继续按 Classical 格式兼容 |
| `.list` | Loon、Surge、Shadowrocket、Egern 等客户端 |
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

IP 文件保持 Mihomo Classical 写法，目标 `IP-CIDR` 自动附加 `no-resolve`，降低 DNS 泄漏风险：

```yaml
payload:
  - IP-CIDR,114.514.19.19/32,no-resolve
  - IP-CIDR,118.32.109.0/24,no-resolve
  - IP-CIDR,5.5.5.5/32,no-resolve
```

文本规则文件还会包含生成来源与最后修改时间：

```yaml
# Generated for Custom Direct by Private Rules
# UPDATED: 2026-08-20 23:30:00
payload:
  - DOMAIN-SUFFIX,example.com
```

## 数据源与同步

- **远程订阅**：可以同时引用多个 YAML、LIST 或纯文本地址。
- **GeoSite**：数据来自 [`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community)。
- **GeoIP**：使用 [`Loyalsoldier/geoip`](https://github.com/Loyalsoldier/geoip) release 分支中的纯文本数据。
- **图标包**：内置来源为 [`Koolson/Qure`](https://github.com/Koolson/Qure)，也支持自定义 JSON 图标包。
- **自动同步**：可按规则配置 15 分钟至每天的更新间隔，也可以随时手动同步。

远程订阅、GeoSite 和 GeoIP 会保持来源独立。编辑 Geo 数据源时，数据库会用当前来源集合替换旧集合，因此删除来源后不会继续残留已经失效的关联规则。

更换整个来源类型时仍建议新建规则集，让来源语义、同步历史和访问链接保持清晰。

## 安全说明

- 后台读写接口要求登录会话。
- Token 订阅用于隐藏访问路径，不等同于内容加密。
- 获得完整订阅地址的人可以读取对应规则，请妥善保存 `RULE_TOKEN`。
- 每条规则都可以独立关闭订阅访问。
- Telegram Bot 只接受 `TELEGRAM_USER_ID` 指定用户的私聊。
- 不要提交 `.dev.vars`、`.env`、密码、Token 或生产数据库内容。

## 更新与备份

Fork 用户可以同步上游仓库后重新部署，D1 或 SQLite 中的规则不会因为前端更新而被覆盖。升级前建议在设置页导出完整 `.json` 备份。

Cloudflare 数据库结构发生变化时执行：

```bash
pnpm db:migrate:remote
```

Docker 用户升级指定版本：

```bash
docker compose pull
docker compose up -d
curl http://127.0.0.1:5173/health
```

`/health` 返回结果中的 `version` 可以用来确认当前运行版本。

## 本地开发

需要 Node.js 22 与 pnpm 10；只有调试 Workers 运行时或部署到 Cloudflare 时才需要 Cloudflare 账号。

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

打开 `http://localhost:5173/admin/login`。`.dev.vars` 已被 Git 忽略，请在其中设置本地密码与密钥。

常用质量检查：

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

## 技术栈

- Cloudflare Workers、Hono 与 D1
- Node.js、Docker Compose 与 SQLite
- React 19、TypeScript 与 Vite
- Cloudflare Cron Triggers 与 Node Scheduler
- Telegram Bot、Webhook 与 Mini App
- Qure Color 与自定义 JSON 图标包

## 许可证与作者

项目基于 [MIT License](./LICENSE) 开源。

- GitHub：[@Cyclince](https://github.com/Cyclince)
- Telegram：[@chong_redaily](https://t.me/chong_redaily)

> 本项目仅供学习与技术测试使用。请遵守当地法律法规，并对自己的配置、转发内容与访问行为负责。
