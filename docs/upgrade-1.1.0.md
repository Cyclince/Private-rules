# Private Rules 1.0.x → 1.1.0 升级指南

本指南适用于从 **1.0.0–1.0.7** 升级至 **1.1.0**（含 `1.1.0-beta.2` 公测版）的 Docker Compose 与 Cloudflare Workers 部署。

升级后，原有的规则数据、上游来源与订阅链接（`/rules/:file`、`/sub/:token/:file`）全部保持兼容，输出与 1.0.7 逐字节一致（仅 `PROCESS-NAME` 规则有小幅优化，见下文）。`docker-compose.yml` 与 1.0.x 完全一致，Docker 用户只需修改镜像标签就能升级。

> 如果你已经在用 `1.1.0-beta.1`，直接拉取 `1.1.0-beta.2`（或 `:beta`）重建容器，或重新部署 Workers 即可，已有模板与加密节点订阅都会保留。

---

## 升级前必读

1. **先导出一次 JSON 备份**：登录当前 1.0.x 后台 →「设置」→ 导出完整 `.json` 备份并保存到本地。
2. **了解几项行为变化**（完整内容见 [1.1.0 更新说明](./1.1.0.md)）：
   - **`SESSION_SECRET` 变为可选**：不手动设置时，1.1.0 首次启动会自动生成 32 字节加密密钥并存入数据库（供登录会话签名与配置模板节点加密共用），同时在日志中提醒备份时连同数据目录一起备份。如果想自己指定密钥，可按需添加环境变量（见下文「可选环境变量」）。
   - **`PROCESS-NAME` 规则调整**：Loon（`-loon.list`）和 Quantumult X（`-qx.list`）规则文件中会直接省略按程序名匹配的规则（手机端不生效）；sing-box 与通用 JSON 会正常输出 `process_name`。其余规则输出与 1.0.7 逐字节一致。
   - **Loon / Quantumult X 模板默认只输出规则资源**：避免导入时覆盖客户端已有节点；完整配置为实验选项。一键导入按钮在真机核实前暂不显示，统一提供复制链接与二维码。
   - **后台接口与 Telegram 权限收紧**：`/api/*` 仅允许同源访问，Cookie 写操作需要同源校验（自动化脚本请使用 API Key）；Telegram Mini App 不再允许操作备份、API Key 与基础站点设置（服务端返回 `403`）。

---

## 一、Docker Compose（Node.js + SQLite）升级步骤

### 自动备份说明（`.bak-1.0.x`）

1.1.0 首次启动并检测到 1.0.x 数据库时，会在改动任何表结构**之前**，通过 SQLite 在线备份接口自动保存一份升级前快照：

```text
${DATABASE_PATH}.bak-1.0.x
# 默认数据卷路径：/app/data/private-rules.db.bak-1.0.x
```

如果该备份文件已存在，程序不会覆盖它。升级成功后日志会打印：

```text
[private-rules] upgraded 1.0.x database; pre-upgrade backup saved to /app/data/private-rules.db.bak-1.0.x
```

### 升级步骤（只改镜像标签）

现有的 1.0.x `docker-compose.yml` 与 `.env` **其余内容都不用改**，新增的可选环境变量都已有合理默认值。

1. **只修改 `docker-compose.yml` 中的 `image` 这一行**：
   - 公开测试版：`cyclince/private-rules:1.1.0-beta.2`（或 `cyclince/private-rules:beta`；`:latest` 仍指向 `1.0.7`）
   - 正式版推出后：`cyclince/private-rules:1.1.0`

2. **拉取镜像并重建容器**（不要使用 `docker compose down -v`，否则会删除数据卷）：

```bash
docker compose pull
docker compose up -d
```

3. **检查日志与健康状态**：

```bash
docker compose ps
docker compose logs --tail=100 private-rules
curl -s http://127.0.0.1:5173/health
```

确认 `/health` 返回 `"ok": true`、`"database": "ok"` 且 `version` 为 `1.1.0-beta.2`（或目标版本），日志中可以看到 `.bak-1.0.x` 已生成且没有报错。未手动设置 `SESSION_SECRET` 时，首次启动还会打印一行提示：`已自动生成加密密钥，备份时请连同数据目录一起备份`。

---

## 二、Cloudflare Workers + D1 升级步骤

Cloudflare D1 无法像本地 SQLite 一样自动复制 `.bak-1.0.x` 文件，因此**升级前务必先手动执行 `wrangler d1 export` 备份数据库**。

### 1. 导出 D1 全量 SQL 备份（必做）

在本地仓库目录（确认已登录 `wrangler`）执行：

```bash
pnpm exec wrangler d1 export private-rules-db --remote --output=./backup-1.0.x.sql
```

> 如果你的 `wrangler.toml` 修改过 `database_name`，请把命令里的 `private-rules-db` 换成实际数据库名。确认生成的 `backup-1.0.x.sql` 非空后再继续。

### 2. 同步代码并部署 1.1.0

- **Workers Builds（Fork 自动部署）**：将仓库同步到目标分支或 Tag，等待自动构建部署完成（构建命令 `pnpm build`，部署命令 `pnpm deploy`）。
- **本地 Wrangler 部署**：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm deploy
```

> 如需自行保管加密密钥，可按需在 Cloudflare Dashboard → **Settings → Variables and Secrets** 中添加 `SESSION_SECRET`（或运行 `pnpm exec wrangler secret put SESSION_SECRET`）。留空时会自动生成并保存在 D1 数据库中。

### 3. 数据库自动升级与验证

- 1.1.0 统一使用 `src/data/migrations` 目录管理数据库迁移（已在 `wrangler.toml` 中配置）。
- Worker 部署后，在**首次 HTTP 请求或 Cron 触发**时会自动识别 1.0.x 表结构并完成升级；如需手动确认，也可以执行 `pnpm db:migrate:remote`。
- 打开 `https://<你的域名>/health` 确认版本号和 `"database": "ok"`，再登录 `/admin` 检查原有规则、上游来源和订阅链接。

---

## 三、可选环境变量

以下环境变量都有默认值，**无需写进 `docker-compose.yml`**（保持与 1.0.7 一致）。如需微调，再按需加到 `docker-compose.yml` 的 `environment` 或 Cloudflare Worker 的 Variables / Secrets 中：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | 留空时自动生成并持久化 | 会话签名与节点订阅 AES-256-GCM 加密密钥。手动设置时生产环境至少 **32 个字符**（推荐 `openssl rand -hex 32`）。**设置或更换该值会让现有登录失效，已保存的节点订阅也需要重新填写**；留空时备份请连同数据目录（或 D1）一起备份。 |
| `LOG_LEVEL` | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `SCHEDULER_ENABLED` | `true` | Node / Docker 是否启用内置定时同步与会话清理 |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | 定时任务轮询间隔（秒，范围 `1`–`86400`） |
| `TELEGRAM_WEBHOOK_SECRET` | 留空时自动生成并持久化 | 自定义 Telegram Webhook 校验密钥 |
| `DATABASE_PATH` | `/app/data/private-rules.db` | Node / Docker SQLite 数据库文件路径 |
| `HOST` / `PORT` | `0.0.0.0` / `5173` | Node / Docker 监听地址与端口 |
| `TRUST_PROXY` | `true`（Compose）/ `false`（直接运行） | 仅在可信反向代理后设为 `true`，用于识别 `X-Forwarded-For` |

---

## 四、回滚到 1.0.7

如果升级后遇到问题，可以按下面的步骤安全回到 `1.0.7`。

### 1. Docker Compose 回滚

1. **停止容器**（保留数据卷）：

```bash
docker compose stop private-rules
```

2. **用自动生成的 `.bak-1.0.x` 恢复 `private-rules.db`**（同时清理 `-wal` 和 `-shm` 残余文件）：

> 先执行 `docker volume ls` 确认实际卷名（通常是项目目录名加 `_private-rules-data`，下面以 `private-rules_private-rules-data` 为例）。

```bash
docker run --rm -v private-rules_private-rules-data:/app/data alpine sh -c '
  set -e
  test -f /app/data/private-rules.db.bak-1.0.x
  cp /app/data/private-rules.db /app/data/private-rules.db.failed-1.1.0
  rm -f /app/data/private-rules.db-wal /app/data/private-rules.db-shm
  cp /app/data/private-rules.db.bak-1.0.x /app/data/private-rules.db
'
```

3. **把 `docker-compose.yml` 的镜像改回 `cyclince/private-rules:1.0.7` 并启动**：

```bash
docker compose pull
docker compose up -d
curl -s http://127.0.0.1:5173/health
```

确认 `version` 恢复为 `1.0.7`，登录后台检查规则和订阅链接。

### 2. Cloudflare Workers + D1 回滚

1. **回退 Worker 代码到 1.0.7**：在 Cloudflare Dashboard → Worker → **Deployments** 中选择 **Rollback** 回到升级前的 1.0.7 版本，或在本地切回 `1.0.7` 后执行 `pnpm build && pnpm deploy`。
2. **恢复数据库状态**（二选一）：
   - **完整 SQL 恢复（推荐）**：新建一个干净的 D1 数据库，导入升级前保存的 SQL 备份：
     ```bash
     pnpm exec wrangler d1 execute <新数据库名> --remote --file=./backup-1.0.x.sql
     ```
     然后在 Worker **Settings → Bindings** 把 `DB` 切换到这个新数据库。
   - **通过 JSON 备份恢复**：如果回退到 1.0.7 后后台能直接打开（1.1.0 升级不会删除 1.0.7 原有表），可以在 1.0.7 后台「设置」里导入升级前导出的 1.0.x `.json` 备份。

> [!NOTE]
> 1.1.0 导出的 `version: 2` JSON 备份无法直接导入回 1.0.7。建议把升级前导出的 1.0.x `.json` 备份、`.bak-1.0.x` 与 `backup-1.0.x.sql` 至少保留到稳定运行一段时间后再清理。
