# 中继服务部署（plaitcode.com）

跨网络协作的中转服务：**只存密文**，负责把消息按频道转发给在线设备。
部署在阿里云香港 ECS（2 vCPU / 2 GB / Ubuntu 26.04），nginx 终止 TLS，中继只监听 `127.0.0.1`。

## 一条命令部署

服务器上用 root 执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay/install.sh -o /tmp/plaitcode-install.sh
bash /tmp/plaitcode-install.sh
```

脚本会依次完成 8 步，每步打印结果：

| 步骤 | 做什么 |
|---|---|
| 0 | 检查系统与架构（Ubuntu/Debian、x86_64/arm64） |
| 1 | `apt` 装 nginx、certbot、curl |
| 2 | 下载 Node 22.11.0 到 `/opt/node`（**不动系统 apt 源**，避免以后 `apt upgrade` 把 Node 升坏） |
| 3 | 建系统用户 `plaitcode`（非 root）+ 数据目录 `/var/lib/plaitcode-relay` |
| 4 | 从仓库下载 `server.cjs` 到 `/opt/plaitcode-relay` |
| 5 | 装 `plaitcode-relay.service`（systemd，`ProtectSystem=strict`、`MemoryMax=512M`）并自检 `/health` |
| 6 | nginx 反代 `plaitcode.com` / `www` / `relay` → `127.0.0.1:8787`（长轮询超时 60s） |
| 7 | Let's Encrypt 签发证书 + 自动续期（`certbot.timer`） |
| 8 | journald 上限 200 MB + HTTPS 自检 |

要改域名或邮箱：

```bash
PLAITCODE_DOMAIN=example.com PLAITCODE_EMAIL=you@example.com bash /tmp/plaitcode-install.sh
```

## 部署后的日常命令

```bash
systemctl status plaitcode-relay     # 服务状态
journalctl -u plaitcode-relay -f     # 实时日志
curl -s https://plaitcode.com/health # 健康检查
nginx -t && systemctl reload nginx   # 改完 nginx 配置
certbot certificates                 # 证书与到期时间
```

## 更新中继程序

```bash
# 本地（改了 src/sync/relay*.ts 之后）
npm run build:relay
git add deploy/relay/server.cjs && git commit -m "relay: rebuild" && git push

# 服务器
curl -fsSL https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay/server.cjs \
  -o /opt/plaitcode-relay/server.cjs
systemctl restart plaitcode-relay
```

## 数据与隐私

- **不保存明文**：设备用配对密钥派生的 AES-256-GCM 密钥加密，中继只见密文与路由信息；
- **不持久化**：消息在内存里保留最近 500 条/频道，重启即清空。每台设备自己保存团队群记录
  （`docs/TEAM-CHAT.md`）与对齐账本（`docs/PLATFORM-ALIGNMENT.md`），所以中继不需要备份；
- **监听范围**：只绑 `127.0.0.1`，公网入口只有 nginx 的 443；
- **权限**：systemd 里限死可写目录，服务以 `plaitcode` 用户运行，不是 root。

## 排障

| 现象 | 先查 |
|---|---|
| `https://plaitcode.com/health` 打不开 | `nginx -t`、`systemctl status nginx`、安全组 80/443 |
| 证书签发失败 | `dig plaitcode.com +short` 是否等于本机公网 IP；80 是否被占用 |
| 服务反复重启 | `journalctl -u plaitcode-relay -n 50 --no-pager` |
| 设备连不上（403） | 两台设备的配对信息不一致，重新「新建/加入跨网频道」 |
