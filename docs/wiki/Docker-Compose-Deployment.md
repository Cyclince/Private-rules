# Docker Compose 从零部署

Private Rules 已提供 Docker Hub 镜像。部署服务器只需要 Docker Engine 与 Docker Compose v2。

## 1. 检查 Docker 环境

```bash
docker version
docker compose version
```

如果命令不存在，请先按照 Docker 官方文档安装 Docker Engine 和 Compose 插件。

## 2. 创建部署目录

```bash
mkdir -p /opt/private-rules
cd /opt/private-rules
```

下载 Compose 配置和环境变量模板：

```bash
curl -fsSLO https://raw.githubusercontent.com/Cyclince/Private_rules/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Cyclince/Private_rules/main/.env.example -o .env
chmod 600 .env
```

## 3. 填写密钥

如需私密订阅，生成一个随机 Token：

```bash
openssl rand -hex 24
```

编辑 `.env`，填写后台密码与可选的私密订阅 Token：

```dotenv
ADMIN_PASSWORD=设置一个独立的高强度后台密码
RULE_TOKEN=粘贴上面的随机值
```

- `ADMIN_PASSWORD`：登录管理后台使用。
- `RULE_TOKEN`：生成私密订阅地址，请勿公开。

登录会话密钥和 Telegram Webhook 密钥由后端首次启动时自动生成，并保存在应用数据库中，无需写入 `.env`。

## 4. 启动服务

先检查配置：

```bash
docker compose config
```

拉取镜像并启动：

```bash
docker compose pull
docker compose up -d
```

检查状态和日志：

```bash
docker compose ps
docker compose logs --tail=100 private-rules
```

容器显示 `healthy` 后访问：

```text
http://服务器地址:5173/admin/login
```

如果服务器启用了防火墙，需要允许 TCP 端口 `5173`，或者通过现有反向代理转发该端口。

## 5. 数据保存

SQLite 数据保存在 Docker volume 中：

```text
private-rules-data
```

停止或重新创建容器不会删除该 volume。不要执行下面的命令，除非确定要永久删除所有规则数据：

```bash
docker compose down -v
```

日常备份建议在管理后台“设置”页面导出 JSON 文件。

## 6. 升级

项目的 `docker-compose.yml` 默认锁定稳定版 `cyclince/private-rules:1.0.5`；`cyclince/private-rules:latest` 同时指向这个版本。升级后重新拉取镜像：

```bash
cd /opt/private-rules
curl -fsSLO https://raw.githubusercontent.com/Cyclince/Private_rules/main/docker-compose.yml
docker compose pull
docker compose up -d
docker compose ps
```

升级前建议先导出 JSON 备份。

## 7. 常见问题

### 提示 `Set ADMIN_PASSWORD in .env`

`.env` 文件不存在，或者对应值仍为空。确认文件位于 `docker-compose.yml` 相同目录。

### 容器不断重启

```bash
docker compose logs --tail=200 private-rules
```

重点检查 `ADMIN_PASSWORD` 是否已填写，以及端口 `5173` 是否被其他程序占用。

### 无法打开页面

确认容器为 `healthy`，服务器防火墙允许 `5173/tcp`，并使用服务器真实 IP 地址访问，而不是在其他电脑上访问 `127.0.0.1`。

### 如何确认运行版本

```bash
curl http://127.0.0.1:5173/health
```

返回结果中的 `version` 是当前容器运行的版本号。
