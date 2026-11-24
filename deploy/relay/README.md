# 中继服务部署（plaitcode.com）

跨网络协作的中转服务：**只存密文**，负责把消息按频道转发给在线设备。

## 两个安装脚本，按机器选

| 脚本 | 适用 | 特点 |
|---|---|---|
| `install.sh` | Ubuntu / Debian（香港节点用的这个） | apt + certbot + `sites-available` |
| **`install-portable.sh`** | **CentOS / Alibaba Cloud Linux / Ubuntu 都行**（新加坡节点用的这个） | 自动识别 apt/dnf/yum；nginx 用 `conf.d` 或 `sites-available`；证书用 acme.sh |

**为什么会有第二个脚本**：`install.sh` 假定 Ubuntu/Debian，在 Alibaba Cloud Linux 上会直接退出；
而且它会 `rm -f sites-enabled/default` —— 如果机器上已经跑着别的站点，那是破坏性操作。
`install-portable.sh` **只新增 vhost、不删任何现有配置**，并按 `server_name` 接管域名，
同一台机器上的其它站点不受影响。

```bash
# 通用版（推荐先用这个）
PLAITCODE_DOMAIN=plaitcode.com PLAITCODE_EMAIL=你的邮箱 \
  bash <(curl -fsSL https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay/install-portable.sh)
```

### 换节点时怎么保留数据

频道 ID 由密钥派生、身份库与频道历史都在 `/var/lib/plaitcode-relay`。
把目录整体搬过去，设备不用重新登记、看板历史也接得上：

```bash
# 旧机器
tar czf /tmp/relay-data.tgz -C /var/lib/plaitcode-relay .
# 新机器
tar xzf relay-data.tgz -C /var/lib/plaitcode-relay
chown -R plaitcode:plaitcode /var/lib/plaitcode-relay
systemctl restart plaitcode-relay
```

环境变量（身份模式 / 飞书 SSO / 审计 / 机器人通知）在
`/etc/systemd/system/plaitcode-relay.service.d/override.conf`，一起拷过去即可；
换了域名要同步改 `PLAITCODE_PUBLIC_URL`。

客户端只改地址、频道密钥不变：命令面板 →「PlaitCode: 切换中继地址（保留频道）」。

## 一条命令部署（Ubuntu / Debian）

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

# 服务器（注意 sleep：systemctl restart 返回时进程刚起来，端口可能还没 listen）
curl -fsSL https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay/server.cjs \
  -o /opt/plaitcode-relay/server.cjs
systemctl restart plaitcode-relay
sleep 2
curl -s https://plaitcode.com/health   # 应输出 {"ok":true,...}
```

如果 `curl` 立刻返回 nginx 的 **502**，先别改配置，等两秒再试：

```bash
curl -s http://127.0.0.1:8787/health          # 直连服务
systemctl status plaitcode-relay --no-pager  # 服务是否 active
journalctl -u plaitcode-relay -n 30 --no-pager
```

`/health` 从本机也连不上 = 服务真的挂了（看日志）；
本机能连、走域名 502 = nginx 或证书的问题（`nginx -t`）。

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
