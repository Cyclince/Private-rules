<div align="center">

<img src="src/frontend/assets/private-rules-avatar.png" alt="Private Rules" width="112" height="112">

# Private Rules

**在自己的 Cloudflare 账户中聚合、维护并发布私有代理分流规则**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-16858A.svg)](./LICENSE)

[功能概览](#你会得到什么) · [部署](#部署到-cloudflare) · [本地开发](#本地开发) · [安全说明](#安全说明)

</div>

---

## 这是什么

Private Rules 是一个运行在 Cloudflare Workers 上的自托管规则控制台。它把自定义规则、远程订阅、GeoSite 与 GeoIP 数据源集中到同一个后台，自动去重，并按客户端需要生成 YAML、LIST、TXT 与 JSON 订阅。

规则和会话保存在你自己的 D1 数据库中。每条规则可独立选择私密链接、公开链接或禁止访问，不必把整个规则库暴露给同一种访问策略。

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

## 部署到 Cloudflare

### 1. Fork 并导入仓库

Fork 本仓库，然后在 Cloudflare Dashboard 打开 **Workers & Pages → Create application → Import a repository**，选择自己的 Fork。

| Cloudflare 构建设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Build command | `pnpm build` |
| Deploy command | `pnpm wrangler deploy` |
| Root directory | 留空 |

项目通过 `wrangler.toml` 声明静态资源、定时同步任务和名为 `DB` 的 D1 binding。首次部署后请在 Worker 的 **Settings → Bindings** 中确认 `DB` 已连接。

### 2. 配置密钥

在 **Settings → Variables and Secrets** 中添加：

| Secret | 用途 | 必需 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 登录管理后台 | 是 |
| `SESSION_SECRET` | 签名登录会话，建议至少 32 个随机字符 | 是 |
| `RULE_TOKEN` | 生成私密订阅地址 | 使用私密访问时 |

部署完成后访问：

```text
https://<your-worker-domain>/admin/login
```

如需自定义域名，在 Worker 的 **Domains & Routes** 中添加域名，再到后台“设置”填写相同的站点基础 URL。

## 本地开发

需要 Node.js、pnpm 与一个 Cloudflare 账号。

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

同一规则按文件后缀适配不同客户端，不再为每个软件重复生成入口。

| 后缀 | 适用范围 |
| --- | --- |
| `.yaml` | Mihomo、Clash、OpenClash、Stash |
| `.list` | Loon、Surge、Shadowrocket、Egern 等 |
| `.txt` | 纯文本规则，便于脚本继续处理 |
| `.json` | 结构化数据和二次开发 |

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

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=Cyclince/Private_rules&type=Date)](https://star-history.com/#Cyclince/Private_rules&Date)

</div>

## 技术栈

- Cloudflare Workers、Hono 与 D1
- React 19、TypeScript 与 Vite
- Cloudflare Cron Triggers
- Qure Color 与自定义 JSON 图标包

## 许可证

[MIT](./LICENSE)
