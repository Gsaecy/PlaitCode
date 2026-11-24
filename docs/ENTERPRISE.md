# 企业级能力（阶段一 / 阶段二）

这份文档记录「企业客户能不能用」这个问题的当前答案：**做到哪一步、还缺什么、怎么落地**。

一句话定位：**可私有化的多 agent 协作层** —— 模型和代码留在客户自己的网里，
PlaitCode 只负责让多个 agent 像团队一样协作、让甲方能指挥和验收。

---

## 阶段一：已具备（小团队 / 技术型公司可用）

| 能力 | 现状 | 说明 |
|---|---|---|
| 私有化部署 | ✅ 5 分钟 | `deploy/relay/install.sh`，零依赖单文件 + systemd + nginx + 自动 HTTPS |
| 端到端加密 | ✅ | 设备间 AES-256-GCM，中继只见密文；频道密钥放 URL fragment，不进服务器日志 |
| 跨网络 | ✅ | HTTP 长轮询，任何反向代理都能过；`127.0.0.1` 监听 + nginx 终止 TLS |
| 手机端 | ✅ | `https://<域名>/m`，浏览器 WebCrypto 做加解密 |
| 权限收紧 | ✅ | 权限预设四档 + 敏感文件策略 + 危险命令分档 |
| 审计 | ✅ | 中继侧 JSONL 审计（谁 / 哪台设备 / 什么时间 / 多大密文），不记正文 |
| 组织管控 | ✅ 基础 | `.plaitcode/policy.json`：强制权限上限、命令黑名单、模型白名单、禁联网参考 |
| **组织 / 成员 / 设备 / 角色** | ✅ 数据模型 + 设备令牌作用域 | 见下节；**默认关闭**，打开后只认设备令牌 |

### 组织 / 成员 / 设备 / 角色

**一人多设备、一设备多频道**。角色有四级：

| 角色 | 能发消息 | 能读 | 能管理 |
|---|---|---|---|
| `viewer` | ❌ | ✅ | ❌ |
| `member` | ✅ | ✅ | ❌ |
| `admin` | ✅ | ✅ | ✅ |
| `owner` | ✅ | ✅ | ✅ |

**默认关闭**，因为打开后 `publish/poll` 只认设备令牌（频道密钥不再被接受）。启用方式：

```bash
# 1) 生成管理令牌（只给管理员，别放仓库）
openssl rand -hex 24

# 2) 改 systemd 单元
systemctl edit plaitcode-relay
# 写入：
#   [Service]
#   Environment=PLAITCODE_IDENTITY=/var/lib/plaitcode-relay/identity.json
#   Environment=PLAITCODE_ADMIN_TOKEN=<上一步的值>
systemctl restart plaitcode-relay
```

**管理接口（curl 即可，暂不做界面）**

```bash
ADMIN=<管理令牌>
BASE=https://plaitcode.com

# 建组织
curl -s $BASE/v1/admin/orgs -H "x-plaitcode-admin: $ADMIN" \
  -H 'content-type: application/json' -d '{"name":"Acme"}'

# 加成员（角色：owner/admin/member/viewer）
curl -s $BASE/v1/admin/members -H "x-plaitcode-admin: $ADMIN" \
  -H 'content-type: application/json' -d '{"orgId":"org_xxx","name":"小王","role":"member"}'

# 给成员登记设备，并按频道授权（token 只在这里出现一次，库里只有哈希）
curl -s $BASE/v1/admin/devices -H "x-plaitcode-admin: $ADMIN" \
  -H 'content-type: application/json' \
  -d '{"memberId":"mem_xxx","name":"公司的台式机","platform":"win32",
       "channels":[{"channelId":"<32 位十六进制>","role":"member"}]}'

# 吊销（离职 / 丢电脑）：立刻失效
curl -s $BASE/v1/admin/devices/revoke -H "x-plaitcode-admin: $ADMIN" \
  -H 'content-type: application/json' -d '{"deviceId":"dev_xxx"}'

# 看全量（不含令牌哈希）
curl -s $BASE/v1/admin/state -H "x-plaitcode-admin: $ADMIN"
```

排障文案是可读的，不是裸 403：

```
设备令牌无效 / 设备已被吊销 / 这台设备没有该频道的授权 / 角色 viewer 不能执行 publish
```

### 审计日志

默认落在 `/var/lib/plaitcode-relay/audit.jsonl`，一行一条 JSON：

```json
{"ts":"2026-11-24T01:02:03.000Z","event":"publish","channel":"9f2c…","device":"dev-win","message":"m-1","ip":"203.0.113.7","bytes":128}
```

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `PLAITCODE_AUDIT` | `/var/lib/plaitcode-relay/audit.jsonl` | 落盘路径；设为 `-` 表示只走 stdout |
| `PLAITCODE_AUDIT_STDOUT` | `1` | 同时输出到 journald（`journalctl -u plaitcode-relay \| grep '\[audit\]'`） |
| `PLAITCODE_AUDIT_IP` | `1` | 设为 `0` 不记录客户端 IP（某些地区 IP 属于个人信息） |
| `PLAITCODE_AUDIT_MAX_BYTES` | `20971520` | 单文件上限，超过就轮转 |
| `PLAITCODE_AUDIT_KEEP` | `5` | 保留几个历史文件 |

**审计里没有消息正文** —— 中继本来就看不懂（端到端加密），这对客户是卖点不是限制。

### 送到企业已有的日志平台

不用等我们去对接：把 `PLAITCODE_AUDIT_SINK` 指过去就行，**一行 JSON 原样外送**。

```bash
# UDP syslog（传统 SIEM / rsyslog）
PLAITCODE_AUDIT_SINK=syslog://10.0.0.5:514

# TCP syslog（要可靠就选它，断线自动重连）
PLAITCODE_AUDIT_SINK=syslog+tcp://siem.internal:1514

# 通用 webhook（Splunk HEC / Datadog / 自建网关都能收）
PLAITCODE_AUDIT_SINK=https://siem.example.com/ingest

# OpenTelemetry（经 OTel Collector 接任何后端）
PLAITCODE_AUDIT_SINK=otlp+http://collector:4318/v1/logs
```

外送一律 **fire-and-forget**：日志平台挂了不影响中继，失败不重试、不排队——
完整性由本地 JSONL 保证，外送只是为了集中检索。OTLP 的 payload 是标准
`resourceLogs → scopeLogs → logRecords`，`timeUnixNano` 取自审计行的 `ts`。

### 飞书登录（SSO）

飞书不是标准 OIDC，走 OAuth 2.0 授权码。四个环境变量齐了就生效：

```bash
PLAITCODE_IDENTITY=/var/lib/plaitcode-relay/identity.json   # 必须有身份库（成员在这里）
PLAITCODE_FEISHU_APP_ID=cli_xxxxxxxxxxxx
PLAITCODE_FEISHU_APP_SECRET=xxxxxxxx                         # 只存在于服务器
PLAITCODE_AUTH_SECRET=$(openssl rand -hex 32)                # 会话签名密钥
PLAITCODE_AUTH_EMAIL_DOMAINS=yourcompany.com,acme.com        # 允许自动开户的域名
```

飞书后台对应配置：应用能力 → **网页应用**（打开方式选「在浏览器中打开」）、
安全设置 → 重定向 URL = `https://<你的域名>/v1/auth/feishu/callback`、
权限 = `contact:user.base:readonly`（必需）+ `contact:user.email:readonly`（**推荐**，见下）。
改权限后必须**创建新版本并发布**才生效，只点「开通」不会生效。

流程：

```
GET /v1/auth/feishu/start      → 302 到飞书授权页（state 自带签名与 10 分钟有效期）
GET /v1/auth/feishu/callback   → 换 user_access_token → 取姓名/邮箱/open_id
                               → 配了白名单却没拿到邮箱 → 403（提示去开邮箱权限）
                               → 邮箱不在白名单 → 403
                               → 认人：邮箱 → open_id → union_id；都没有 → 409
                               → 第一次来就在第一个组织自动开户为 member
                               → 下发 HttpOnly + Secure + SameSite=Lax 会话 Cookie → 302 /m
GET /v1/auth/me                → 当前成员（未登录 401）
POST /v1/auth/logout           → 清 Cookie
```

**离职即失效**：飞书停用账号后 SSO 登不进来；再用管理接口 `devices/revoke` 吊销设备，
两条路一起断。设备令牌仍然由管理员发放（不做自助登记，避免"谁都能把自己加进来"）。

**成员映射的优先级**（`findMemberByIdentity`）：

| 顺序 | 标识 | 说明 |
|---|---|---|
| 1 | `email`（小写比对） | 最稳，能直接对上企业邮箱目录；审计里也最好读 |
| 2 | `open_id` | 应用内唯一，**没有邮箱权限时靠它认人** |
| 3 | `union_id` | 同开发者多应用之间唯一，作为兜底 |

因此 `PLAITCODE_AUTH_EMAIL_DOMAINS` 的语义是"**配了就强制校验**"：

- 白名单**非空** → 必须有邮箱，且域名在名单内；没邮箱直接 403 并提示去开
  `contact:user.email:readonly`（安全优先，绝不因为拿不到邮箱就放过）；
- 白名单**为空** → 不限制域名，靠 `open_id` 也能开户（内网自用 / 演示环境）。

先用 open_id 开的户，等客户后来补开邮箱权限，下一次登录会**自动把邮箱补写**进成员记录，
不需要重建账号。


### 开启身份模式后，客户端怎么配

`PLAITCODE_IDENTITY` 一开，中转的 `publish/poll/presence` 就**只认设备令牌**；频道密钥全部失效。
顺序别搞反，否则会看到一片 403：

1. **管理员发设备令牌**（每个开发者每台电脑一个）：

   ```bash
   curl -s -X POST https://<你的域名>/v1/admin/devices \
     -H "x-plaitcode-admin: $ADMIN" -H 'content-type: application/json' \
     -d '{"memberId":"mem_xxx","name":"小王-笔记本","platform":"win32",
          "channels":[{"channelId":"<32 位频道 ID>","role":"member"}]}'
   ```

   响应里的 `token` **只显示这一次**（库里只存哈希），直接发给对应开发者。

2. **开发者登记令牌**：命令面板 →「PlaitCode: 登记本机设备令牌」→ 粘贴。
   令牌存进 SecretStorage（不进 `settings.json`），扩展激活时自动读取并重连；留空提交即清除。

3. **频道 ID 从哪来**：「PlaitCode: 查看跨网中继状态」会显示完整的 32 位十六进制串，
   管理员授权设备时用的就是它。
   （0.7.3 以前「新建 / 加入跨网频道」会因为 `plaitcode.relay.url` 没在
   `package.json` 里声明而直接报错，升级到 0.7.3 即可。）

4. **手机**：命令面板 →「PlaitCode: 手机加入团队群（二维码）」扫码；
   身份模式下手机页用**登录 Cookie** 鉴权，频道密钥只用于解密，不再当票据。

手机为什么会话鉴权能过：`authorizeSession` 按「成员 + 频道归属」判断——
同组织里任意一台**未吊销**设备被授予过该频道，这个频道就算该组织的；
组织内 `viewer` 只读、`member` 及以上可发；**跨组织一律拒绝**。
设备被吊销后，同组织成员也随之失去该频道访问。

### 一个人多台设备：指派 + 任务看板

同一个人在多台电脑上接力做同一个项目时，用**指派**而不是"每台都做"：

1. 在第一台电脑上执行「PlaitCode: 给另一台设备发配对信息（含设备令牌）」，
   配对信息已复制到剪贴板。
2. 在第二台电脑上执行「PlaitCode: 加入跨网频道」，**粘贴那一行**。
   频道密钥和设备令牌一次到位，不需要去服务器发令牌。
3. **指派**：手机 `/m` 底部，或电脑「团队群」输入框上方的「由谁执行」chips，
   选目标设备（`所有人 / 本机 / 其它在线设备`），然后说需求。
4. **只有被选中的那台电脑**的 agent 执行；其余设备只在看板里记录，
   本机会明确提示「这条需求已指派给 <设备名>，本机未执行」。
5. 任意一端都能看到任务看板：`等你回复 / 未执行 / 进行中 / 待接 / 已完成`。
6. 想中途收手：电脑团队群右上「停止执行」或手机 `/m` 底部「停止」，
   由**正在执行的那台**中断 agent，并把「已停止」回执同步到频道。

> 中继会把频道历史落盘（只存密文），所以重启或换设备接入都不会丢上下文。
> `PLAITCODE_HISTORY=-` 可关闭；`PLAITCODE_SELF_ENROLL=0` 可关闭自助登记。

### 手机端怎么进入（三个入口，都不需要装 App）

1. **扫码**（最常用）：电脑上「PlaitCode: 手机加入团队群（二维码）」→ 手机扫码。
   未登录会自动跳飞书登录，**登录回来直接进入**，不用再粘配对信息。
2. **加到主屏幕（PWA）**：打开 `https://<你的域名>/m`，浏览器菜单里选
   「添加到主屏幕」。之后点图标即用，独立窗口、无地址栏。
3. **飞书工作台**：飞书开放平台 → 你的应用 → 网页应用主页地址填
   `https://<你的域名>/m`，员工从飞书里点开就带登录态。

`/m` 底部是「权限档位 / 步数 / 停止」控制条 + 指派 + 输入框；
需要授权的工具会以红框卡片出现在对话流顶部，手机上点允许/拒绝即可。

**通知**：配 `PLAITCODE_FEISHU_WEBHOOK=<飞书自定义机器人 webhook>` 后，
「需要批准 / 任务完成 / 未执行」会推到飞书。只发元数据，不发代码。

不选「由谁执行」= 频道内所有设备都跑（旧行为，适合 Windows/macOS 各做一份的场景）。

**结局一定有回执**：需求到达后要么显示「已在 <项目> 开始处理」，要么明确写出没开始的原因
（未同意数据流向 / 未配置 API Key / 被企业策略拦下）。不再出现"发出去就没下文"。

结果回执在电脑团队群里按**原样多行**渲染（代码块、列表、文件清单都保留换行），
不再挤成一行；手机 `/m` 同样保留换行。

### 企业策略（`policy.json`）

放在工作区 `.plaitcode/policy.json`，或用 MDM / 仓库模板统一下发：

```json
{
  "version": 1,
  "permissionPreset": "review",
  "denyCommands": ["rm -rf", "/curl\\s*\\|\\s*sh/i", "/\\.ssh/"],
  "modelAllowlist": ["deepseek-*", "qwen-*"],
  "allowInternetReference": false
}
```

规则：

1. **只收紧**：策略的预设比用户选的更宽松时不生效（取更严格的那个）；用户自己选更严格的保留；
2. **可解释**：被命令黑名单拦下时，工具返回 `企业策略禁止这条命令（命中规则：…）`，不表现成莫名其妙的失败；
3. **坏文件按最严处理**：JSON 解析失败 → 回落到 `askAll` 并在日志里说明，绝不静默失效；
4. **模型白名单为空 = 不限制**；全部被禁时拒绝发送并提示联系管理员。

---

## 阶段二：进行中（中型企业，50–500 人）

| 项 | 状态 | 说明 |
|---|---|---|
| 审计流水（JSONL） | ✅ 已完成 | 见上 |
| 策略下发 | ✅ 已完成 | 见上 |
| **组织 / 团队 / 成员 / 设备 / 角色** | ✅ 已完成 | 一人多设备、一设备多频道；设备令牌只存哈希；可吊销 |
| **SSO（OIDC / SAML）** | ✅ 飞书已支持 | 授权码流程 + 会话 Cookie；首次登录按邮箱自动开户 |
| SCIM 自动开户销户 | ⬜ 未开始 | 依赖 SSO |
| 审计导出到 SIEM | ✅ 已完成 | `PLAITCODE_AUDIT_SINK`：syslog(UDP/TCP) / webhook / OTLP |
| 境内节点 + 备案 | ⬜ 待启动 | **流程 1–3 周，建议尽早开始**，不占开发资源 |
| 配额与计量 | ⬜ 未开始 | 按席位 / 设备 / 消息量；需要先有组织模型 |

### 为什么「身份」是必须先做的一层

现在的认证单位是**频道密钥**：谁拿到钥匙谁就是甲方。一个人几台电脑刚好，
但企业必须能回答三个问题，没有组织模型三个都答不了：

- 员工离职，怎么立刻吊销他的设备？
- A 项目成员只能看 A 项目，怎么隔离？
- 谁有权批准「执行 shell」？本人还是管理员？

这决定数据模型，**越晚改成本越高**。0.6.0 已经把这层数据模型和令牌作用域做完（见上），
剩下的只有「怎么登录」——那是 SSO 的事，不改变数据模型。

---

## 阶段三：暂不做（大型企业 / 国企 / 金融）

等保三级、商用密码应用安全性评估（密评）、SOC 2 Type II、SLA 99.9% + 多可用区。
这些都需要 1–3 个月的测评周期和真实的付费客户来支撑，**不建议在没有客户之前投入**。

---

## 落地顺序建议

1. **审计 + 策略**（已完成）—— 企业安全问卷上能勾掉三行；
2. **境内节点备案**（流程并行，今天就能启动）；
3. **组织 / 角色 / 设备模型**（2–3 周，数据模型改动）；
4. **OIDC SSO**（1 周，依赖客户 IdP 联调）；
5. **配额与计量**（商业化前提）；
6. 等有付费客户再启动等保 / 密评。

## 安全问卷速答（拿去谈客户）

| 客户会问 | 我们的回答 |
|---|---|
| 代码会不会被你们看到？ | 不会。设备间端到端加密，中继只转发密文；模型调用直连客户自己的端点 |
| 能不能私有化部署？ | 能。单文件 + systemd，5 分钟；不需要任何外部依赖 |
| 数据存哪？ | 默认不落盘（消息在内存环形缓冲）；审计只有元数据。私有化部署时可指定目录 |
| 能不能禁用某些命令？ | 能。`policy.json` 里 `denyCommands`，命中直接拒绝并说明规则 |
| 能不能限制模型？ | 能。`modelAllowlist` 支持通配；全禁时拒绝发送 |
| 有没有审计？ | 有。JSONL 一行一条，可关 IP，可按大小轮转，可导 SIEM |
| 员工离职怎么办？ | **阶段二待补**：目前是撤销频道密钥（能挡住，但不够细） |
