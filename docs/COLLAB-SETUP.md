# 多台电脑 + 手机协作

> **普通用户只看第 1 节。** 第 2 节是给「自己部署协作服务」的人看的，做一次，之后所有用户都不用碰服务器。

---

## 1. 普通用户：三步

1. 在 VS Code 里装 PlaitCode
2. 命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）→ **PlaitCode: 开始协作（GitHub 登录）** → 浏览器里用 GitHub 点一次 **Authorize**
3. 第二台电脑执行同一个命令；手机执行 **PlaitCode: 手机加入团队群（二维码）** 扫一次

不需要买服务器、填地址、记配对码、配环境变量。

**唯一要留意的是电源**：这台电脑要一直开着才能接需求。显示器可以关，系统不能睡。第一次执行时插件会提醒你一次，并给一条能直接复制的命令（见第 3 节）。

之后怎么用：手机上发一句人话 → 两台电脑各自复述理解、含糊处给你二选一 → 你回答 → 它们确认后才动手 → 做完报结果并告诉你怎么验证。

---

## 2. 部署方：给自己的用户提供协作服务

配好之后，**所有用户都只做第 1 节那三步**。

### 2.1 先在 GitHub 建一个 OAuth App（一次）

1. GitHub → 头像 → **Settings** → 左侧最下 **Developer settings**
2. **OAuth Apps** → **New OAuth App**
3. 填：

| 字段 | 值 |
|---|---|
| Application name | `PlaitCode`（随意） |
| Homepage URL | `https://你的域名` |
| Authorization callback URL | `https://你的域名/v1/auth/github/callback` |

4. 复制 **Client ID**，再 **Generate a new client secret** 复制 secret（只显示一次）

只要 `read:user` 权限：只读「你是哪个账号」，**不碰任何仓库**。

### 2.2 一键开启（推荐）

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay/setup-github-login.sh)
```

问你三个值（域名、Client ID、Client Secret），然后自动：

- 写一个**独立**的 drop-in（`10-github-login.conf`，不覆盖你已有的 `override.conf`）
- 生成或沿用 `PLAITCODE_AUTH_SECRET`
- 重启并自检（会检查日志里有没有「GitHub 登录已启用」）

想关掉：`rm -f /etc/systemd/system/plaitcode-relay.service.d/10-github-login.conf && systemctl daemon-reload && systemctl restart plaitcode-relay`

### 2.3 手工配置

```ini
# /etc/systemd/system/plaitcode-relay.service.d/10-github-login.conf
[Service]
Environment=PLAITCODE_IDENTITY=/var/lib/plaitcode-relay/identity.json
Environment=PLAITCODE_PUBLIC_URL=https://你的域名
Environment=PLAITCODE_GITHUB_CLIENT_ID=你的ClientID
Environment=PLAITCODE_GITHUB_CLIENT_SECRET=你的ClientSecret
Environment=PLAITCODE_AUTH_SECRET=openssl rand -hex 32 的结果
```

```bash
systemctl daemon-reload && systemctl restart plaitcode-relay
journalctl -u plaitcode-relay -n 20 --no-pager | grep -E "GitHub|身份模式"
```

期望看到：

```
[relay] 身份模式：0 组织 / 0 成员 / 0 设备
[relay] GitHub 登录已启用
```

> 每个 GitHub 账号自动得到一个**独立空间**：他和他的设备在里面，别人看不到。
> 跨人协作以后用「邀请」单独做，不默认共享。

### 2.4 隐私边界

- 中继只存**密文**与元数据，解不开消息
- 设备令牌只存哈希
- 频道密钥**从不经过明文**：第二台设备登录后，由第一台用它自己的公钥加密后转交
- 谁登录了你的 GitHub 账号，谁就能把自己的电脑接进来 —— 所以 GitHub 账号要开两步验证

---

## 3. 电脑设置：要不要关休眠

**要关。** 这不是可选项。

| 现象 | 原因 |
|---|---|
| agent 跑到一半停了 | 睡眠时整个 VS Code 进程被冻结 |
| 手机发的需求没反应 | 睡眠 = 网卡断电 = 中继连接断开 |
| 第二天显示「重连中」 | 醒来要重新握手，中间的消息靠服务器落盘补，但任务不会自己续跑 |

可以关显示器，**系统不能睡**。

### Windows

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

笔记本还要管合盖：设置 → 系统 → 电源和电池 → 其他电源设置 →
**选择关闭盖子的功能** → 「接通电源时」改成 **不采取任何操作**。

### macOS

```bash
# sleep 0：永不休眠；displaysleep 10：显示器 10 分钟后关（不影响运行）
sudo pmset -a sleep 0 disksleep 0 displaysleep 10

# 合盖也要跑（合盖散热差，注意通风）
sudo pmset -a disablesleep 1
```

只想在跑任务时临时挡住：`caffeinate -dimsu`

### 两个平台都要注意

- **VS Code 窗口不能关**：扩展进程活在窗口里，关窗等于拔掉连接
- 不要用「休眠」（hibernate）：内存写盘再断电，醒来上下文全丢
- 用电池时让它睡是合理的，按「接通电源」设就行

---

## 4. 排查

| 症状 | 看这里 |
|---|---|
| 「这个服务暂时没有开放 GitHub 登录」 | 部署方还没配（第 2 节），不是用户的问题 |
| 浏览器报 `redirect_uri_mismatch` | 回调地址必须**完全等于** `https://你的域名/v1/auth/github/callback` |
| 第二台一直等密钥 | 第一台没开 VS Code，或已被吊销。确认第一台状态栏是「中继已连接」 |
| 两台设备频道 ID 不一样 | 第二台自己新建了频道。在第一台重跑一次「开始协作」再看 |
| 手机打不开 `/m` | `curl https://你的域名/health` 先确认服务与证书 |
| 消息延迟大 | 检查电脑是否睡眠（Windows「现代待机」也会断网） |

查看本机状态与频道 ID：**PlaitCode: 查看跨网中继状态**

---

## 5. 关于服务器（为什么需要它）

它不提供算力 —— 模型仍由扩展直接调用。它不可替代的是四件事：

| 价值 | 为什么扩展做不到 |
|---|---|
| 可达性 | 手机在 4G 下要找到家里的电脑，没有公网 IP 就必须有中转 |
| 持久性 | 电脑关机时，消息要有人接住 |
| 中立性 | 「谁属于这个频道、谁被吊销」不能自己说了算 |
| 常驻性 | 没人看着时还在跑 |

前三条已经在用；第四条（电脑全关也能排队接活）还没做。