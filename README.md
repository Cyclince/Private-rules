# Private Rules

Private Rules 是一个部署在 Cloudflare Workers 上的通用代理规则订阅管理工具。通过后台维护分类和规则，系统会自动生成适用于 Mihomo、Sing-Box、Loon、Quantumult X、Surge、Shadowrocket 等客户端的分流规则文件。

## 技术架构

- **Cloudflare Workers + Hono**：处理后台 API、认证、订阅文件和静态资源回退。
- **Cloudflare D1**：保存分类、规则、设置和登录会话。
- **Vite + React**：构建单页管理后台，由 Workers 的 Assets binding 提供静态资源。

## 使用示例

1. 访问 `/admin/login`，使用服务端设置的 `ADMIN_PASSWORD` 登录。
2. 创建分类，例如 `AI`、`Emby`、`GitHub`。
3. 添加域名、关键词、通配域名、IP 或 CIDR；批量导入时一行一条，`#` 开头的行会成为后续规则的备注。
4. 在“链接”页选择分类和客户端，复制相应的订阅地址。

常用订阅地址：

```text
/rules/AI.yaml                 # 公开链接（需启用）
/sub/<RULE_TOKEN>/AI.yaml      # Token 链接
/sub/<RULE_TOKEN>/AI-qx.list   # Quantumult X
/sub/<RULE_TOKEN>/AI.json      # JSON
```

## 从零部署（推荐）

### 开始前

你需要一个 GitHub 账号、一个 Cloudflare 账号和一个托管在Cloudfare的域名。

### 第 1 步：Fork 本项目

在 GitHub 打开本项目页面，点击右上角 **Fork**，再点击 **Create fork**。之后请使用你自己账号下的仓库，不要直接修改原仓库。

### 第 2 步：让 Cloudflare 从 GitHub 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages**。
2. 点击 **Create application** → **Workers** → **Import a repository**。
3. 选择 **GitHub**，按提示授权 Cloudflare，并选择刚 Fork 的仓库。
4. 分支选择 `main`。
5. 在构建设置中填写：

| 设置 | 填写内容 |
| --- | --- |
| Build command | `pnpm build` |
| Deploy command | `pnpm wrangler deploy` |
| Root directory | 留空 |

6. 点击 **Save and Deploy**，等待部署完成。

### 第 3 步：填写三个密钥

部署成功后，打开 **Workers & Pages → private-rules-worker → Settings → Variables and Secrets**，点击 **Add**，类型选择 **Secret**，分别添加：

| 名称 | 填写内容 |
| --- | --- |
| `ADMIN_PASSWORD` | 你用来登录后台的强密码 |
| `SESSION_SECRET` | 任意随机长字符串，建议 32 个字符以上 |
| `RULE_TOKEN` | 任意随机长字符串，用于隐藏订阅链接 |

每项添加后点击 **Save**。前两项必须填写；不使用 Token 订阅链接时，第三项可不填，并在登录后台后关闭 Token 链接。

### 第 4 步：登录后台

在 Worker 的 **Settings → Domains & Routes** 复制 `workers.dev` 地址，然后访问：

```text
https://你的-worker.你的-workers-dev-子域.workers.dev/admin/login
```

使用 `ADMIN_PASSWORD` 登录。首次打开稍等片刻，进入“设置”后确认 D1 显示“已连接”；然后即可创建分类、添加规则并在“链接”页复制订阅地址。

### 第 5 步：修改自定义域名

以 `rules.example.com` 为例：

1. 确认 `example.com` 已添加到当前 Cloudflare 账号，且状态为“有效”。
2. 打开 **Workers & Pages → private-rules-worker → Settings → Domains & Routes**。
3. 点击 **Add → Custom Domain**，填写 `rules.example.com`，然后确认。
4. 等待 Cloudflare 自动创建 DNS 记录和 HTTPS 证书；状态变为“Active”后即可访问 `https://rules.example.com`。
5. 登录后台，打开“设置”，将 `baseUrl` 填为 `https://rules.example.com` 并保存。之后生成的订阅链接会自动使用新域名。

### 更新方式

以后在 GitHub 修改 Fork 后的仓库并提交到 `main`，Cloudflare 会自动重新构建和发布，不需要重复配置密钥或数据库。

### 常见问题

**又出现 `No such module "node:events"`**：说明你仍在使用在线代码编辑器。请删除该 Worker，改用第 2 步的 **Import a repository**；Git 部署会读取 [wrangler.toml](wrangler.toml) 中的 `nodejs_compat` 配置。

**构建失败，提示未找到 pnpm**：确认 Build command 完全是 `pnpm build`，不要使用 `npm run build`。

**后台无法登录**：确认当前 Worker 的 Variables and Secrets 中已添加 `ADMIN_PASSWORD` 和 `SESSION_SECRET`，并且类型是 Secret。

**D1 未连接**：第一次部署后等待片刻并刷新。仍无效时，打开 Worker 的 **Settings → Bindings**，应能看到名称为 `DB` 的 D1 binding。

**访问 `/admin/login` 显示 404**：确认 GitHub 仓库已包含最新版 `wrangler.toml`，并在 Cloudflare 的 **Deployments** 页面重新部署最新提交。该配置会让登录和订阅等动态地址优先交给 Worker 处理。

### 本地开发（可选）

```bash
pnpm install
pnpm dev
```

## 安全说明

所有后台规则读写操作均要求在已登录的情况下，Token 链接用于隐藏路径而非加密；任何取得完整规则分流链接的人都能读取对应规则，请不要把 Token泄漏到任何地方。

## 目录

- `src/worker.ts`：Worker 路由和订阅输出入口。
- `src/lib/`：D1 数据访问、认证、解析和格式化。
- `src/frontend/`：React 管理后台、样式和浏览器端状态。
- `migrations/` 与 `seed.sql`：D1 数据库结构和示例数据。
