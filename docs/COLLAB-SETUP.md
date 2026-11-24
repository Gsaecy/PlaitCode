# 多台电脑 + 手机协作：完整设置

> 目标：**同一个 GitHub 账号**登录的每台电脑自动进同一条频道，手机扫码即可指挥。
> 全程不需要配对码、二维码密钥串或任何手工复制的字符串。
>
> 一台电脑点一次命令 → 浏览器里登录一次 → 第二台电脑再点同一个命令就自动接上。

---

## 0. 先回答你最关心的那个问题：要不要关休眠

**要关。** 这不是可选项。

| 现象 | 原因 |
|---|---|
| agent 跑到一半停了 | 电脑睡眠时整个 VS Code 进程被冻结，跑任务的进程停在那里 |
| 手机发的需求没反应 | 睡眠 = 网卡断电 = 中继连接断开，消息进不来 |
| 第二天看到「重连中」 | 醒来后要重新握手，中间那段消息靠服务器落盘补，但任务不会自己续跑 |

**可以关显示器，但系统不能睡。** 屏幕黑掉不影响；系统进入睡眠就全停。

### Windows

```powershell
# 接通电源时永不睡眠（0 = 从不）
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

笔记本还要管合盖（否则一合盖就睡）：

设置 → 系统 → 电源和电池 → 其他电源设置 → **选择关闭盖子的功能** →
「接通电源时」改成 **不采取任何操作**。

### macOS

```bash
# sleep 0：永不休眠；displaysleep 10：显示器 10 分钟后关（不影响运行）
sudo pmset -a sleep 0 disksleep 0 displaysleep 10

# 合盖也不睡（合盖散热差，注意通风；不想这样就把笔记本开着盖）
sudo pmset -a disablesleep 1
```

只想在跑任务时临时挡住睡眠：

```bash
caffeinate -dimsu
```

### 两个平台都要注意

- **VS Code 窗口不能关。** 扩展进程活在窗口里，关窗就等于拔掉中继。
- 不要用「休眠」（hibernate）：它把内存写盘再断电，醒来上下文全丢。
- 睡眠策略按「接通电源」设就行，用电池时让它睡是合理的。

---

## 1. 在 GitHub 上建一个 OAuth App（只需做一次）

1. GitHub → 右上头像 → **Settings** → 左侧最下 **Developer settings**
2. **OAuth Apps** → **New OAuth App**
3. 填：

| 字段 | 值 |
|---|---|
| Application name | `PlaitCode`（随意） |
| Homepage URL | `https://你的域名` |
| Authorization callback URL | `https://你的域名/v1/auth/github/callback` |

4. 创建后复制 **Client ID**，再点 **Generate a new client secret** 复制 **Client secret**（只显示一次）

> 权限只要 `read:user`：只读「你是哪个账号」，**不碰你的仓库**。

---

## 2. 服务器上的环境变量

写在 systemd 的 `override.conf` 里（`systemctl edit plaitcode-relay`，或直接 `cat > /etc/systemd/system/plaitcode-relay.service.d/override.conf`）：

```ini
[Service]
Environment=PLAITCODE_IDENTITY=/var/lib/plaitcode-relay/identity.json
Environment=PLAITCODE_PUBLIC_URL=https://你的域名
Environment=PLAITCODE_GITHUB_CLIENT_ID=你的ClientID
Environment=PLAITCODE_GITHUB_CLIENT_SECRET=你的ClientSecret

# 会话签名密钥：只生成一次，之后不要再改（改了所有人要重新登录）
# openssl rand -hex 32
Environment=PLAITCODE_AUTH_SECRET=上一步生成的那串
```

然后：

```bash
systemctl daemon-reload
systemctl restart plaitcode-relay
journalctl -u plaitcode-relay -n 20 --no-pager | grep -E "GitHub|身份模式"
```

看到这两行就对了：

```
[relay] 身份模式：0 组织 / 0 成员 / 0 设备
[relay] GitHub 登录已启用
```

> 第一个用 GitHub 登录的人自动成为管理员，并自动建一个组织。
> 之后同一个 GitHub 账号的其它设备都是同一个成员。

---

## 3. 第一台电脑

命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）→ **PlaitCode: 开始协作（GitHub 登录）**

1. 第一次会让你填中继地址（如 `https://你的域名`），只填一次
2. 浏览器自动打开 → 用 GitHub 登录 → 看到「登录完成，可以关掉这个窗口」
3. 回到 VS Code：团队群窗口自动打开，状态栏显示 `$(globe) 中继已连接`

这一步它会自动做完：建频道 → 把频道登记到服务器 → 生成本机密钥对 → 保存设备令牌。

**你的 GitHub 账号第一次登录时，频道是新建的**（因为账号里还没有频道）。

---

## 4. 第二台电脑（同一个 GitHub 账号）

装同一个扩展 → 同样执行 **PlaitCode: 开始协作（GitHub 登录）**。

区别只有一个：它不会新建频道，而是**等第一台电脑把频道密钥送过来**。

```
第 2 台：这个账号已经在协作中，正在等另一台设备把频道密钥送过来…
第 1 台：（后台心跳，30 秒一轮）[handoff] 已把频道密钥交给「macOS 版」
第 2 台：已拿到频道密钥 → 团队群打开
```

**前提：第一台电脑此刻开着 VS Code。** 因为密钥只在设备上，服务器没有。
如果第一台不在线，第二台会提示「等不到密钥」，等第一台开机后重跑一次命令即可。

> 为什么不能由服务器直接发密钥：那样服务器就能解密你的消息，
> 端到端加密就名存实亡了。现在的做法是「用第二台的公钥加密，只有它能解开」。

---

## 5. 手机

电脑上执行 **PlaitCode: 手机加入团队群（二维码）** → 手机扫码。

- 未登录会自动跳 GitHub 登录，**登录回去直接进频道**，不用再扫码
- 想当 App 用：浏览器菜单 → 添加到主屏幕（PWA）
- 手机能做：发需求、选「由谁执行」、点允许/拒绝授权、改权限档位、停止执行、看任务看板

手机不需要装任何东西，也不需要和电脑在同一个 WiFi。

---

## 6. 怎么用（一次完整的需求）

1. 手机上发一句人话：「会员快到期的时候要能提醒用户续费」
2. 两台电脑上的 agent 各自复述理解，含糊的地方给你**二选一**
3. 你回答后它们发一条确认，然后才动手
4. 做完在群里报结果，并告诉你**自己怎么验证**
5. 任务看板：等你回复 / 未执行 / 进行中 / 待接 / 已完成

想只让某一台做：手机上「由谁执行」选那台，或者电脑团队群里选。

---

## 7. 排查

| 症状 | 看这里 |
|---|---|
| 命令里报「这台中继没有配置 GitHub 登录」 | 服务器缺 `PLAITCODE_GITHUB_CLIENT_ID` / `SECRET` |
| 浏览器报 `redirect_uri_mismatch` | GitHub OAuth App 的回调地址要**完全等于** `https://你的域名/v1/auth/github/callback` |
| 第二台一直等密钥 | 第一台没开 VS Code，或第一台也被吊销了；确认第一台状态栏是「中继已连接」 |
| 两台设备频道 ID 不一样 | 第二台自己新建了频道（说明它登录时账号里没有授权）。在第一台重新执行一次「开始协作」再看 |
| 手机打不开 `/m` | 域名解析、证书、备案；`curl https://你的域名/health` 先确认 |
| 消息延迟大 | 检查电脑是否在睡眠；Windows 的「现代待机」也会断网 |

查看本机状态与频道 ID：**PlaitCode: 查看跨网中继状态**

---

## 8. 安全边界（这套设计守住的线）

- **中继看不到消息内容**：频道密钥只在设备上，消息端到端加密
- **中继看不到令牌原文**：库里只存哈希
- **钥匙交接也不经过明文**：用目标设备的公钥加密，中继只转发密文
- **吊销立即生效**：控制台 `/console` 点一下，那台设备马上失去访问
- **GitHub 权限只要 `read:user`**：不读仓库、不写仓库

风险也要知道：**任何能登录你这个 GitHub 账号的人，都能把自己的电脑接进这个频道**。
所以 GitHub 账号本身要开两步验证。
