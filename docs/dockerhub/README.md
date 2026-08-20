# Private Rules

Private Rules 是一个操作简单、维护方便的私有自托管规则控制台。Docker 镜像内置 Web 控制台、Node.js 服务与 SQLite 数据库支持，使用 Docker Compose 即可运行，无需下载源码或在服务器上编译。

项目源码：[Cyclince/Private_rules](https://github.com/Cyclince/Private_rules)

## 快速部署

```bash
mkdir -p private-rules && cd private-rules
curl -fsSLO https://raw.githubusercontent.com/Cyclince/Private_rules/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/Cyclince/Private_rules/main/.env.example -o .env
```

编辑 `.env`：

```dotenv
ADMIN_PASSWORD=设置后台登录密码
RULE_TOKEN=设置私密订阅Token
```

启动：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

默认访问：

```text
http://服务器地址:5173/admin/login
```

## 数据与升级

规则数据保存在 Docker volume `private-rules-data` 中，重新创建或升级容器不会删除数据。

```bash
docker compose pull
docker compose up -d
```

Compose 默认锁定稳定版 `cyclince/private-rules:1.0.5`；`cyclince/private-rules:latest` 同时指向这个版本。两个标签均支持 `linux/amd64` 与 `linux/arm64`。

详细步骤请查看 [Docker Compose 从零部署](https://github.com/Cyclince/Private_rules/wiki/Docker-Compose-Deployment)。

## License

[MIT](https://github.com/Cyclince/Private_rules/blob/main/LICENSE)
