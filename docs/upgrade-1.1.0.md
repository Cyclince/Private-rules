# Private Rules 1.0.x → 1.1.0 升级指南

本指南适用于从 **1.0.0–1.0.7** 升级至 **1.1.0**（包括 `1.1.0-beta.1` 公开测试版）的 Docker Compose 与 Cloudflare Workers 部署。

升级后，原有 1.0.x 的全部规则集数据、来源配置与订阅地址（`/rules/:file`、`/sub/:token/:file`）均保持兼容，规则集订阅输出与 1.0.7 逐字节一致。

---

## 升级前必读

1. **在 1.0.x 后台导出 JSON 备份**：登录当前 1.0.x 管理后台 →「设置」→ 导出完整 `.json` 备份并妥善保存到本地。
2. **确认行为变化**（详见 [1.1.0 发布说明](./1.1.0.md)）：
   - **节点绑定必须显式配置 `SESSION_SECRET`**：1.1.0 的模板发布支持绑定节点订阅地址（AES-256-GCM 加密存储），但强制要求在环境变量中显式提供 `SESSION_SECRET`，不再回退使用数据库内自动生成的密钥。
   - **`/api/*` CORS 收紧与 CSRF 校验**：`/api/*` 仅允许同源访问；Cookie 会话写操作必须携带 `Content-Type: application/json` 与同源 `Origin`；自动化脚本请使用 API Key（`Authorization: Bearer prk_...`）。
   - **Telegram Mini App 权限收紧**：Mini App 会话不再允许访问备份、API Key 与高风险基础设施设置（服务端返回 `403`）。
3. **准备显式 `SESSION_SECRET`**（建议提前生成，长度 ≥ 32 字符）：

```bash
openssl rand -hex 32
```

> [!IMPORTANT]
> 请妥善保存生成的 `SESSION_SECRET` 且升级后**不要随意更改**。更改 `SESSION_SECRET` 会使现有登录会话立即失效，并导致已加密存储的节点订阅绑定无法解密（需要在发布页重新填写订阅地址）。

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

### 升级步骤

1. **在 `.env` 中补充 `SESSION_SECRET`**（如计划使用模板节点绑定，此项为必需；生产环境必须 ≥ 32 字符）：

```dotenv
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=用_openssl_rand_-hex_32_生成的至少32位随机密钥
RULE_TOKEN=你的私密订阅令牌
BASE_URL=https://rules.example.com
```

2. **更新 `docker-compose.yml`**：
   - 将仓库最新的 `docker-compose.yml` 中的 `environment` 项同步到你的部署文件（确保透传 `SESSION_SECRET`，并可按需设置 `LOG_LEVEL`、`SCHEDULER_ENABLED`、`SCHEDULER_INTERVAL_SECONDS`、`TELEGRAM_WEBHOOK_SECRET`）。
   - 修改 `image` 标签为目标版本：
     - 公开测试版：`cyclince/private-rules:1.1.0-beta.1`（或 `cyclince/private-rules:beta`）
     - 正式版发布后：`cyclince/private-rules:1.1.0`

3. **拉取镜像并重建容器**（切勿使用 `docker compose down -v`，否则会删除数据卷）：

```bash
docker compose pull
docker compose up -d
```

4. **检查升级日志与健康状态**：

```bash
docker compose ps
docker compose logs --tail=100 private-rules
curl -s http://127.0.0.1:5173/health
```

确认 `/health` 返回 `"ok": true`、`"database": "ok"` 且 `version` 为目标版本，同时日志中确认 `.bak-1.0.x` 已生成且无报错。

---

## 二、Cloudflare Workers + D1 升级步骤

Cloudflare D1 无法像本地 SQLite 一样在文件系统中自动复制 `.bak-1.0.x` 文件，因此**升级前必须先手工执行 `wrangler d1 export` 备份远端数据库**。

### 1. 导出 D1 全量 SQL 备份（必做）

在本地仓库目录（确认已登录 `wrangler`）执行：

```bash
pnpm exec wrangler d1 export private-rules-db --remote --output=./backup-1.0.x.sql
```

> 如你的 `wrangler.toml` 中自定义了 `database_name`，请将命令中的 `private-rules-db` 替换为实际数据库名。请检查生成的 `backup-1.0.x.sql` 非空后再继续。

### 2. 配置显式 `SESSION_SECRET`

在 Cloudflare Dashboard 打开 Worker → **Settings → Variables and Secrets**，添加名为 `SESSION_SECRET` 的 **Secret**（推荐用 `openssl rand -hex 32` 生成，≥ 32 字符）；或通过命令行设置：

```bash
pnpm exec wrangler secret put SESSION_SECRET
```

> 如果暂时不配置 `SESSION_SECRET`，Worker 仍可正常启动与提供规则集订阅，但创建或使用「模板发布节点绑定」时会返回 `503 SESSION_SECRET_REQUIRED`。

### 3. 同步代码并部署 1.1.0

- **Workers Builds（Fork 自动部署）**：同步仓库到目标发布分支或 Tag，等待构建部署完成（构建命令 `pnpm build`，部署命令 `pnpm deploy`）。
- **本地 Wrangler 部署**：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm deploy
```

### 4. 数据库自动升级与验证

- 1.1.0 将迁移文件目录统一为 `src/data/migrations`（已在 `wrangler.toml` 配置 `migrations_dir = "src/data/migrations"`）。
- Worker 在部署后的**首次 HTTP 请求或 Cron 触发**时，会自动检测 1.0.x 历史表结构（兼容已使用 `d1_migrations` 与仅靠运行时建表两种状态），通过迁移锁幂等补齐基线并执行 1.1.0 新增迁移。
- 如希望在部署后显式确认迁移，也保留了手动命令：`pnpm db:migrate:remote`。
- 访问 `https://<你的域名>/health` 确认版本号与 `"database": "ok"`，再登录 `/admin` 核对规则集、来源与订阅链接。

---

## 三、如何确认 `SESSION_SECRET` 配置生效

1. 升级完成后登录 `/admin`，进入 **发布管理**（`/admin/publications`）。
2. 新建或编辑发布，尝试给节点槽位绑定订阅地址：
   - 若 `SESSION_SECRET` 已显式配置，保存后界面仅显示脱敏地址（订阅明文加密存储，不出现在 API 响应、日志与备份中）；
   - 若未显式配置 `SESSION_SECRET`，界面与服务端会返回 `503 SESSION_SECRET_REQUIRED` 提示。
3. 如使用 Docker 部署且 `NODE_ENV=production`，填写少于 32 个字符的 `SESSION_SECRET` 会在容器启动阶段直接报错退出，请更换为至少 32 字符的随机密钥后重启。

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
