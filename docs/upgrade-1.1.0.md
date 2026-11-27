# Private Rules 1.0.x → 1.1.0 升级指南

本指南适用于从 **1.0.0–1.0.7** 升级至 **1.1.0**（包括 `1.1.0-beta.1` 公开测试版）的 Docker Compose 与 Cloudflare Workers 部署。

升级后，原有 1.0.x 的全部规则集数据、来源配置与订阅地址（`/rules/:file`、`/sub/:token/:file`）均保持兼容，规则集订阅输出与 1.0.7 逐字节一致。`docker-compose.yml` 配置结构也与 1.0.x 完全兼容，Docker 用户只需修改镜像标签即可直接升级。

---

## 升级前必读

1. **在 1.0.x 后台导出 JSON 备份**：登录当前 1.0.x 管理后台 →「设置」→ 导出完整 `.json` 备份并妥善保存到本地。
2. **确认行为变化**（详见 [1.1.0 发布说明](./1.1.0.md)）：
   - **`SESSION_SECRET` 可选配置**：未显式设置 `SESSION_SECRET` 时，1.1.0 会自动生成并持久化 32 字节加密密钥（供会话签名与模板节点订阅绑定 AES-256-GCM 加密共用），首次生成时日志会提示将密钥随数据目录一起备份；如希望自行托管密钥，可按需通过环境变量显式配置（见下文「可选环境变量」）。
   - **`/api/*` CORS 收紧与 CSRF 校验**：`/api/*` 仅允许同源访问；Cookie 会话写操作必须携带 `Content-Type: application/json` 与同源 `Origin`；自动化脚本请使用 API Key（`Authorization: Bearer prk_...`）。
   - **Telegram Mini App 权限收紧**：Mini App 会话不再允许访问备份、API Key 与高风险基础设施设置（服务端返回 `403`）。

---

## 一、Docker Compose（Node.js + SQLite）升级步骤

### 自动备份说明（`.bak-1.0.x`）

1.1.0 的 Node/SQLite 运行时在首次启动并检测到 1.0.x 数据库时，会在写入任何迁移追踪表或新表结构**之前**，通过 SQLite 在线备份 API 自动生成一份 WAL 安全的升级前快照：

```text
${DATABASE_PATH}.bak-1.0.x
# 默认数据卷路径：/app/data/private-rules.db.bak-1.0.x
```

若该文件已存在则不会覆盖；升级成功后日志会打印：

```text
[private-rules] upgraded 1.0.x database; pre-upgrade backup saved to /app/data/private-rules.db.bak-1.0.x
```

### 升级步骤（只改镜像标签）

现有的 1.0.x `docker-compose.yml` 与 `.env` **无需修改其他字段**，所有 1.1.0 新增的可选环境变量均已在代码中提供合理默认值。

1. **只修改 `docker-compose.yml` 中的 `image` 标签**：
   - 公开测试版：`cyclince/private-rules:1.1.0-beta.1`（或 `cyclince/private-rules:beta`）
   - 正式版发布后：`cyclince/private-rules:1.1.0`

2. **拉取镜像并重建容器**（切勿使用 `docker compose down -v`，否则会删除数据卷）：

```bash
docker compose pull
docker compose up -d
```

3. **检查升级日志与健康状态**：

```bash
docker compose ps
docker compose logs --tail=100 private-rules
curl -s http://127.0.0.1:5173/health
```

确认 `/health` 返回 `"ok": true`、`"database": "ok"` 且 `version` 为目标版本，同时日志中确认 `.bak-1.0.x` 已生成且无报错。如果未显式设置 `SESSION_SECRET`，首次启动日志还会打印一次自动生成密钥的备份提醒。

---

## 二、Cloudflare Workers + D1 升级步骤

Cloudflare D1 无法像本地 SQLite 一样在文件系统中自动复制 `.bak-1.0.x` 文件，因此**升级前必须先手工执行 `wrangler d1 export` 备份远端数据库**。

### 1. 导出 D1 全量 SQL 备份（必做）

在本地仓库目录（确认已登录 `wrangler`）执行：

```bash
pnpm exec wrangler d1 export private-rules-db --remote --output=./backup-1.0.x.sql
```

> 如你的 `wrangler.toml` 中自定义了 `database_name`，请将命令中的 `private-rules-db` 替换为实际数据库名。请检查生成的 `backup-1.0.x.sql` 非空后再继续。

### 2. 同步代码并部署 1.1.0

- **Workers Builds（Fork 自动部署）**：同步仓库到目标发布分支或 Tag，等待构建部署完成（构建命令 `pnpm build`，部署命令 `pnpm deploy`）。
- **本地 Wrangler 部署**：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm deploy
```

> 如需自行管理加密密钥，可按需在 Cloudflare Dashboard → **Settings → Variables and Secrets** 中添加 `SESSION_SECRET`（或运行 `pnpm exec wrangler secret put SESSION_SECRET`），留空时会自动生成并保存在 D1 数据库中。

### 3. 数据库自动升级与验证

- 1.1.0 将迁移文件目录统一为 `src/data/migrations`（已在 `wrangler.toml` 配置 `migrations_dir = "src/data/migrations"`）。
- Worker 在部署后的**首次 HTTP 请求或 Cron 触发**时，会自动检测 1.0.x 历史表结构（兼容已使用 `d1_migrations` 与仅靠运行时建表两种状态），通过迁移锁幂等补齐基线并执行 1.1.0 新增迁移。
- 如希望在部署后显式确认迁移，也保留了手动命令：`pnpm db:migrate:remote`。
- 访问 `https://<你的域名>/health` 确认版本号与 `"database": "ok"`，再登录 `/admin` 核对规则集、来源与订阅链接。

---

## 三、可选环境变量

以下 1.1.0 新增或可微调的环境变量均在代码中有默认值，因此**不需要写进 `docker-compose.yml`**（保持与 1.0.x 一致）。如需自定义，可在 `docker-compose.yml` 的 `environment` 或 Cloudflare Worker 的 Variables / Secrets 中按需添加：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 留空时自动生成并持久化 | 会话签名与节点订阅 AES-256-GCM 加密密钥。自定义时生产环境需至少 **32 字符**（推荐 `openssl rand -hex 32`）。**设置或更换该值会使现有登录会话失效，并让已保存的节点订阅绑定需要重新填写**；未显式配置时备份请连同数据目录（或 D1）一起备份。 |
| `LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `SCHEDULER_ENABLED` | `true` | Node / Docker 部署是否启用内置定时同步与会话清理调度器 |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | Node / Docker 调度器轮询间隔（秒，范围 `1`–`86400`） |
| `TELEGRAM_WEBHOOK_SECRET` | 留空时自动生成并持久化 | 自定义 Telegram Webhook 校验密钥 |
| `DATABASE_PATH` | `/app/data/private-rules.db` | Node / Docker SQLite 数据库文件路径 |
| `HOST` / `PORT` | `0.0.0.0` / `5173` | Node / Docker 监听地址与端口 |
| `TRUST_PROXY` | `true`（Compose） / `false`（裸跑） | 仅在受信任反向代理后设为 `true`，以识别 `X-Forwarded-For` |

---

## 四、回滚到 1.0.7

如果公测或升级后遇到阻塞问题，可按以下方式安全回滚至 `1.0.7`。

### 1. Docker Compose 回滚

1. **停止当前容器**（保留数据卷）：

```bash
docker compose stop private-rules
```

2. **将自动生成的 `.bak-1.0.x` 备份恢复为 `private-rules.db`**（清理 WAL/SHM 残余文件）：

> 请先用 `docker volume ls` 确认实际卷名（默认项目目录前缀 + `_private-rules-data`，下面以 `private-rules_private-rules-data` 为例）。

```bash
docker run --rm -v private-rules_private-rules-data:/app/data alpine sh -c '
  set -e
  test -f /app/data/private-rules.db.bak-1.0.x
  cp /app/data/private-rules.db /app/data/private-rules.db.failed-1.1.0
  rm -f /app/data/private-rules.db-wal /app/data/private-rules.db-shm
  cp /app/data/private-rules.db.bak-1.0.x /app/data/private-rules.db
'
```

3. **将 `docker-compose.yml` 的镜像改回 `cyclince/private-rules:1.0.7` 并启动**：

```bash
docker compose pull
docker compose up -d
curl -s http://127.0.0.1:5173/health
```

确认 `version` 恢复为 `1.0.7`，登录后台检查规则集与订阅地址。

### 2. Cloudflare Workers + D1 回滚

1. **回退 Worker 代码到 1.0.7**：在 Cloudflare Dashboard → Worker → **Deployments** 中直接 **Rollback** 到升级前的 1.0.7 版本，或在本地切换回 `1.0.7` 代码执行 `pnpm build && pnpm deploy`。
2. **恢复数据库状态**（二选一）：
   - **完整 SQL 恢复（推荐，彻底移除 1.1.0 新增表）**：新建一个干净的 D1 数据库并导入升级前导出的 SQL 备份：
     ```bash
     pnpm exec wrangler d1 execute <新数据库名> --remote --file=./backup-1.0.x.sql
     ```
     随后在 Worker **Settings → Bindings** 将 `DB` 绑定切换到该恢复后的数据库。
   - **通过 JSON 备份恢复**：如果 1.0.7 版本启动后直接可访问后台（1.1.0 升级不删除 1.0.7 核心表），可在 1.0.7 管理后台「设置」中导入升级前导出的 1.0.x `.json` 备份以还原规则集与设置。

> [!NOTE]
> 1.1.0 导出的 `version: 2` JSON 备份无法直接导入回 1.0.7；因此升级前保存的 1.0.x `.json` 备份、`.bak-1.0.x` 与 `backup-1.0.x.sql` 是回滚的关键凭据，建议至少保留至稳定运行一段时间后再清理。
