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
| **SSO（OIDC / SAML）** | ⬜ 未开始 | 需要客户提供 IdP（Azure AD / Okta / 飞书 / 企业微信） |
| SCIM 自动开户销户 | ⬜ 未开始 | 依赖 SSO |
| 审计导出到 SIEM | ✅ 已完成 | `PLAITCODE_AUDIT_SINK`：syslog(UDP/TCP) / webhook / OTLP |
| 境内节点 + 备案 | ⬜ 待启动 | **流程 1–3 周，建议尽早开始**，不占开发资源 |
| 配额与计量 | ⬜ 未开始 | 按席位 / 设备 / 消息量；需要先有组织模型 |

### 为什么「身份」是必须先做的一层

现在的认证单位是**频道密钥**：谁拿到钥匙谁就是甲方。一个人两台电脑刚好，
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
