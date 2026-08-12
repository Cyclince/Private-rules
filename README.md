<div align="center">

<img src="src/frontend/assets/private-rules-favicon.png" alt="Private Rules" width="112" height="112">

# Private Rules

**操作简单、维护方便的私有自托管规则控制台**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/cyclince/private-rules)
[![License: MIT](https://img.shields.io/badge/License-MIT-16858A.svg)](./LICENSE)

[功能概览](#你会得到什么) · [部署到 Cloudflare](#部署到-cloudflare) · [部署到 Docker](#部署到-docker) · [本地开发](#本地开发) · [安全说明](#安全说明)

</div>

---

## 这是什么

Private Rules 是一个操作简单、维护方便的私有自托管规则控制台，支持 **Cloudflare Workers** 和 **Docker Compose** 部署。它把自定义规则、远程订阅、GeoSite 与 GeoIP 数据源集中到同一个后台，自动去重，并按客户端需要生成 YAML、LIST、TXT 与 JSON 订阅。

规则和会话保存在你自己的 Cloudflare D1 或自托管 SQLite 数据库中。每条规则可独立选择私密链接、公开链接或禁止访问，不必把整个规则库暴露给同一种访问策略。

## 为什么需要它

公开规则集很方便，但个人规则往往来自多个维护者，也会包含只适合自己的媒体、AI、地区或代理策略。手动复制这些内容容易重复、失去更新，甚至把不该公开的规则一起暴露。

Private Rules 保留上游的持续更新能力，同时让自定义内容和访问权限仍由你控制。

## 你会得到什么

| 能力 | 结果 |
| --- | --- |
| 多来源聚合 | 组合远程 YAML/LIST、GeoSite、GeoIP 与自定义规则，按“类型 + 内容”自动去重 |
| 私有发布 | 为每条规则独立配置 Token、公开或禁用访问，并生成多种文件后缀 |
| 可视化维护 | 在响应式后台中创建、同步、搜索、批量预览、备份和恢复规则 |

上游镜像保持只读，自定义规则不会被下一次同步覆盖。GeoSite 与 GeoIP 可以组合使用，例如同时引入 Telegram 域名与 IP 网段。

## 部署方式对照

| 能力 | Cloudflare Workers | Docker Compose |
| --- | --- | --- |
| 运行时 | Workers | Node.js |
| 数据库 | D1 | SQLite |
| 定时任务 | Cron Trigger | Node Scheduler |
| 静态资源 | Workers Assets | Node Static |
| 持久化 | Cloudflare | Docker Volume |
| 运维成本 | 低 | 用户自行维护 |
| 适用场景 | 无服务器部署 | VPS、NAS、本地服务器 |

## 部署到 Cloudflare

### 1. Fork 并导入仓库

Fork 本仓库，然后在 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Import a repository**，选择自己的 Fork。

| Cloudflare 构建设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Build command | `pnpm build` |
| Deploy command | `pnpm deploy` |
| Root directory | 留空 |

项目通过 `wrangler.toml` 声明静态资源、定时同步任务和名为 `DB` 的 D1 binding。首次部署后请在 Worker 的 **Settings → Bindings** 中确认 `DB` 已连接。

首次使用或仓库新增 migration 后执行：

```bash
pnpm db:migrate:remote
```

`wrangler.toml` 中的 Cron Trigger 每 5 分钟触发一次扫描；真正的同步间隔仍由每条数据源在数据库中的配置决定。自定义域名绑定后可设置 `BASE_URL`，也可以在管理后台设置站点基础 URL。


### 2. 配置密钥

在 **Settings → Variables and Secrets** 中添加：

| 变量或 Secret | 用途 | 必需 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 登录管理后台 | 是 |
| `RULE_TOKEN` | 生成私密订阅地址 | 使用私密访问时 |
| `BASE_URL` | 站点的公网 HTTPS 地址 | 否 |
| `TELEGRAM_BOT_TOKEN` | BotFather 提供的 Bot Token | 否 |
| `TELEGRAM_USER_ID` | 唯一允许使用 Bot 的数字用户 ID | 否 |

部署完成后访问：

```text
https://<your-worker-domain>/admin/login
```

如需自定义域名，在 Worker 的 **Domains & Routes** 中添加域名，再到后台“设置”填写相同的站点基础 URL。

### 可选：启用 Telegram Bot

先通过 BotFather 创建 Bot，再填写 `BASE_URL`、`TELEGRAM_BOT_TOKEN` 与 `TELEGRAM_USER_ID`。Worker 会自动生成并持久化会话密钥和 Webhook 密钥，并在首次请求或 Cron 触发时注册命令、Webhook 和 Mini App。Bot 仅接受配置用户的私聊；部署完成后发送 `/start` 即可使用。

## 部署到 Docker

Docker 部署直接使用 Docker Hub 上的多架构镜像，适合 VPS、NAS 和本地服务器。

```bash
mkdir -p private-rules && cd private-rules
curl -fsSLO https://raw.githubusercontent.com/Cyclince/Private-rules/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Cyclince/Private-rules/main/.env.example -o .env
# 编辑 .env，填写 ADMIN_PASSWORD 和按需使用的 RULE_TOKEN
docker compose pull
docker compose up -d
```

访问 `http://服务器地址:5173/admin/login` 即可。

### 可选：启用 Telegram Bot

先通过 BotFather 创建 Bot，再在 `.env` 中填写：

```env
BASE_URL=https://rules.example.com
TELEGRAM_BOT_TOKEN=
TELEGRAM_USER_ID=123456789
```

重启容器后会自动注册命令、Webhook 和 Mini App，无需执行额外命令。`BASE_URL` 必须是下面反向代理提供的公网 HTTPS 地址。Bot 仅接受配置用户的私聊；启动完成后发送 `/start` 即可使用。

### 使用 Caddy 反向代理

先把域名解析到服务器，并放行 TCP 端口 `80` 和 `443`。Caddy 会自动申请和续期 HTTPS 证书。在 `/etc/caddy/Caddyfile` 中加入：

```caddyfile
rules.example.com {
    reverse_proxy 127.0.0.1:5173
}
```

将 `rules.example.com` 替换为你的域名，然后校验并重载配置：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 使用 Nginx 反向代理

在 `/etc/nginx/conf.d/private-rules.conf` 中加入以下配置：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name rules.example.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

将 `rules.example.com` 替换为你的域名，校验配置后重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

以上配置先提供 HTTP；生产环境还应配置 HTTPS，例如使用 Certbot：

```bash
sudo certbot --nginx -d rules.example.com
```

Compose 已启用 `TRUST_PROXY`。不要让不受信任的上游代理覆盖 `Host`、`X-Forwarded-For` 或 `X-Forwarded-Proto`，也不要将管理端口 `5173` 直接暴露到公网；建议通过防火墙仅允许本机或反向代理访问。

常用运维命令：

```bash
docker compose ps
docker compose logs -f --no-color
docker compose stop
docker compose pull
docker compose up -d
```

故障排查：`docker compose ps` 检查健康状态，`docker compose logs --no-color` 查看启动错误。
**不要把密码、Cookie 或完整私密订阅地址贴进公开日志。**

## 本地开发

需要 Node.js 与 pnpm；只有调试 Cloudflare Workers 运行时或部署到 Cloudflare 时才需要 Cloudflare 账号。

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

打开 `http://localhost:5173/admin/login`。`.dev.vars` 已被 Git 忽略，请在其中设置本地密码和密钥。

生产构建检查：

```bash
pnpm build
```

## 使用路径

1. 在“规则”中选择从零构建、远程订阅或 Geo 数据库
2. 为规则选择图标、同步间隔，并按需添加自定义域名、关键词、IP 或 CIDR
3. 同步上游后，在批量预览中检查新增、重复和无效内容
4. 在“订阅”详情中选择当前规则的访问策略并复制对应格式链接
5. 在“设置”中导出完整 JSON 备份，或恢复已有备份

## 订阅格式

同一规则按文件后缀适配不同客户端，以适配多端。

| 后缀 | 适用范围 |
| --- | --- |
| `.yaml` | Mihomo、Clash、OpenClash、Stash |
| `.list` | Loon、Surge、Shadowrocket、Egern 等 |
| `.json` | sing-box source Rule Set |
| `.txt` | 纯文本规则，便于脚本继续处理 |

```text
/rules/emby.yaml
/sub/<RULE_TOKEN>/emby.yaml
/sub/<RULE_TOKEN>/emby.list
/sub/<RULE_TOKEN>/emby.json
```

文本规则文件包含生成来源与最后修改时间：

```yaml
# Generated for emby by Private Rules
# UPDATED: 2026-07-14 08:30:00
payload:
  - DOMAIN-SUFFIX,example.com
```

## 数据源与同步

- 远程订阅：支持同时引用多个 YAML、LIST 或纯文本地址
- GeoSite：来自 [`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community)
- GeoIP：使用 [`Loyalsoldier/geoip`](https://github.com/Loyalsoldier/geoip) release 分支中的纯文本数据
- 图标包：来源 [`Koolson/Qure`](https://github.com/Koolson/Qure)
- 自动同步：按规则配置 15 分钟至每天的更新间隔，也可随时手动同步

远程订阅、GeoSite 和 GeoIP 保持来源独立；更换来源类型时建议新建规则，避免不同数据库语义互相覆盖。

## 安全说明

- 后台读写接口要求登录会话
- Token 订阅用于隐藏访问路径，不等同于内容加密
- 获得完整订阅地址的人可以读取对应规则，请妥善保存 `RULE_TOKEN`
- 每条规则可以独立关闭订阅访问
- 不要提交 `.dev.vars`、密码、Token 或生产数据库内容

## 更新与备份

Fork 用户可以同步上游仓库后重新部署，D1 中的规则不会因前端更新被覆盖。升级前建议在设置页导出完整 `.json` 备份。

数据库结构变更时执行：

```bash
pnpm db:migrate:remote
```

## Star History

<a href="https://www.star-history.com/?repos=Cyclince%2FPrivate-rules&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Cyclince/Private-rules&type=date&theme=dark&legend=top-left&sealed_token=GTq36Pj9JxMOvAY9cUcxN44LKyjX6YrMBtQsHqnSy0kYo6YdkjGTxA9L7cYAWDz3tQikm9ATof0v1g6CkZL_qN28WNc007YskXChEYq87yFLUROyNRT8EwqvszzCTRiFi330rMvVh0XPS7HOSw60mAb3OswRyX6Y3IPU7ERYNrmRYDBzYUKejMPL4aPG" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Cyclince/Private-rules&type=date&legend=top-left&sealed_token=GTq36Pj9JxMOvAY9cUcxN44LKyjX6YrMBtQsHqnSy0kYo6YdkjGTxA9L7cYAWDz3tQikm9ATof0v1g6CkZL_qN28WNc007YskXChEYq87yFLUROyNRT8EwqvszzCTRiFi330rMvVh0XPS7HOSw60mAb3OswRyX6Y3IPU7ERYNrmRYDBzYUKejMPL4aPG" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Cyclince/Private-rules&type=date&legend=top-left&sealed_token=GTq36Pj9JxMOvAY9cUcxN44LKyjX6YrMBtQsHqnSy0kYo6YdkjGTxA9L7cYAWDz3tQikm9ATof0v1g6CkZL_qN28WNc007YskXChEYq87yFLUROyNRT8EwqvszzCTRiFi330rMvVh0XPS7HOSw60mAb3OswRyX6Y3IPU7ERYNrmRYDBzYUKejMPL4aPG" />
 </picture>
</a>

## 技术栈

- Cloudflare Workers、Hono 与 D1
- Node.js、Docker Compose 与 SQLite
- React 19、TypeScript 与 Vite
- Cloudflare Cron Triggers
- Qure Color 与自定义 JSON 图标包

## 许可证

[MIT](./LICENSE)
