# 网站与控制台

> 这份文档回答三个问题：**网站长什么样、入口怎么排、后端怎么实现**。
> 参考的是 2026 年主流代码协作工具（GitHub / GitLab / Bitbucket / Azure DevOps /
> Live Share / Code With Me / Replit / CodePen）的共同做法，但只取对本项目有用的部分。

---

## 1. 先说结论

**网站不单独做，直接由中继进程提供；三个入口，各进各的。**

```
        https://<你的域名>
                │
    ┌───────────┼────────────┬──────────────┐
    ▼           ▼            ▼              ▼
   /           /console      /m          /health
 首页/入口     网页控制台    手机端指挥     探活 JSON
（不登录）    （飞书登录）  （登录或密钥）  （监控用）
```

为什么不再单独搞一个站：

| 方案 | 要额外做的事 | 结论 |
|---|---|---|
| 静态站托管（Vercel/Pages） | 域名、备案、CORS、跨域 Cookie、控制台还得回调中继 | 多三处失败点 |
| 单独的控制台后端 | 再开一套对内接口取设备/通道/审计，多一份攻击面 | 等于把数据复制一遍 |
| **中继直接出页面** | 无（证书、域名、数据都已经在） | **采用** |

中继本来就是零依赖单文件（`deploy/relay/server.cjs`），加两个页面不需要新依赖，
`scp` 上去 `systemctl restart` 就生效。

---

## 2. 入口怎么排

每个入口**只有一个去处**，前端不再做二次跳转判断（判断都放在服务端）。

| 用户在哪 | 想去哪 | 入口 | 落到哪 |
|---|---|---|---|
| 搜索引擎 / 别人发的链接 | 了解这是什么 | `/` | 首页 |
| 首页 | 装扩展 | 首页「在 VS Code 安装」 | Marketplace |
| 首页 | 管设备 | 首页「打开控制台」 | `/console`（→ 飞书登录 → 回 `/console`） |
| 首页 | 用手机指挥 | 首页「手机端」 | `/m` |
| VS Code | 管设备 | 命令「PlaitCode: 打开网页控制台」 | `https://<中继>/console` |
| VS Code | 让第二台电脑接入 | 命令「给另一台设备发配对信息（含设备令牌）」 | 复制一行文本 |
| 第二台电脑 | 接入 | 命令「加入跨网频道」→ 粘贴 | 频道 + 令牌一次到位 |
| 手机 | 指挥 | 扫描二维码（URL fragment 带频道密钥） | `/m#k=…` |
| 手机 | 任务完成/要批准 | 飞书机器人通知 | 深链回 `/m` |

关键取舍：

- **控制台不承担「指挥」**。手机端 `/m` 才是指挥界面；控制台解决的是「换电脑、吊销旧设备、
  看谁在线、查审计」这些不常做但必须能做的事。
- **控制台不发令牌、不生成配对信息**。频道密钥是端到端加密的密钥，服务端从来没有也不该有；
  新设备接入只能从**已有设备**导出配对信息，这一点写进页面文案，避免用户以为网页能变出新设备。
- **登录回跳只认 `/console` 和 `/m`**。`state` 里带的落点走白名单，
  不接受外部地址（`readState` 只返回白名单内的值），否则登录回调就是开放重定向。

---

## 3. 后端实现

### 3.1 页面（服务端渲染，无前端框架）

| 路由 | 文件 | 鉴权 | 缓存 |
|---|---|---|---|
| `GET /` | `src/sync/relaySite.ts` → `renderLandingPage` | 无 | `max-age=300` |
| `GET /console` | `src/sync/relaySite.ts` → `renderConsolePage` | 页面本身无；数据接口有 | `no-store` |
| `GET /m` | `src/sync/relayPage.ts` | 页面本身无；数据接口有 | `no-store` |
| `GET /health` | `relayServer.ts` | 无 | `no-store` |

页面里**不拼任何服务端数据**：设备名、成员名都是用户输入，只在浏览器里用 `textContent` 渲染。
CSP 与 `/m` 一致（`default-src 'none'`，只允许本站 fetch + 内联样式/脚本）。

### 3.2 数据接口

| 接口 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/v1/console/state` | GET | 会话 Cookie | 概览统计、设备、通道、审计尾部 |
| `/v1/console/devices/revoke` | POST | 会话 Cookie | 吊销设备；自己的设备随时可吊销，别人的要 `manage` |
| `/v1/auth/feishu/start?next=console` | GET | 无 | 发起登录，`next` 进 state（白名单） |
| `/v1/auth/feishu/callback` | GET | 无 | 换 token → 写会话 Cookie → 302 回 `next` |
| `/v1/auth/me` / `/v1/auth/logout` | GET / POST | Cookie | 已有 |
| `/v1/admin/*` | 各种 | `x-plaitcode-admin` 头 | 运维用，保留不变 |

`/v1/console/state` 的返回结构（节选）：

```json
{
  "ok": true,
  "member": { "id": "mem_x", "name": "我", "role": "member", "email": "me@acme.com" },
  "org": { "id": "org_x", "name": "我的团队" },
  "members": [{ "id": "mem_x", "name": "我", "role": "member" }],
  "devices": [{
    "id": "dev_x", "name": "公司电脑", "platform": "win32",
    "memberName": "我", "grants": [{ "channelId": "…", "role": "member" }],
    "lastSeenAt": 1763000000000, "online": true
  }],
  "channels": [{
    "channelId": "3f2a…", "devices": 2, "online": 1,
    "deviceNames": ["公司电脑"], "lastMessageAt": 1763000000000
  }],
  "audit": [{ "ts": "2026-11-24T04:00:00.000Z", "event": "publish", "channel": "3f2a…" }],
  "counts": { "devices": 2, "online": 1, "channels": 1, "members": 2 }
}
```

### 3.3 权限口径（与控制面保持一致，不另造一套）

- **组织隔离**：只返回 `member.orgId` 下的成员、设备、通道，跨组织一律 404/空。
- **设备吊销**：`target.memberId === member.id` 随时可吊销（吊销自己的旧电脑是常见需求）；
  别人的设备要求 `roleCan(member.role, 'manage')`（`owner` / `admin`）。
- **在线判定**：复用中继 presence 表，`PRESENCE_TTL_MS`（90 秒）内的才算在线，
  不另存一份"最后在线"，避免两处数据打架。
- **审计**：`AuditLog.tail()` 只读当前文件、不读轮转历史；返回时按本组织频道过滤，
  别人的频道 ID 不出现在你的控制台里。审计仍然只有元数据，没有明文。

### 3.4 部署

不用改部署流程：`/`、`/console` 和 `/m` 一样由中继进程处理，nginx 只要把整个站点反代到
`127.0.0.1:<PORT>` 即可（`deploy/relay/install*.sh` 已经是这么配的）。

只有一处行为变化要注意：**`/` 从 JSON 变成了首页**。监控探活统一用 `/health`
（两个安装脚本和文档里的自检命令本来就用的 `/health`）。

控制台需要服务端开启飞书登录：

```bash
PLAITCODE_AUTH_APP_ID=cli_xxx
PLAITCODE_AUTH_APP_SECRET=xxx
PLAITCODE_AUTH_REDIRECT_URI=https://<你的域名>/v1/auth/feishu/callback
PLAITCODE_AUTH_SECRET=<32 字节随机串>
```

没配时首页会明确写出「这台服务器还没配飞书登录」，控制台页面也会给同样的提示，
不会出现"点进去一片空白"。

---

## 4. 和现有协作工具的分工

参考文章里的 8 个工具各占一段，PlaitCode 只补它们都不做的那一段：

| 工具 | 它擅长 | 差的那一段 |
|---|---|---|
| GitHub / GitLab / Bitbucket / Azure DevOps | 异步评审**已经写完**的代码（PR/MR、分支保护、CI） | 代码还没写出来的那一步 |
| Live Share / Code With Me | 两个人**同时**编辑同一份代码 | 要求双方同时在线 |
| Replit / CodePen | 浏览器里立刻看到结果 | 不是你的真实仓库和环境 |
| **PlaitCode** | 异步下达需求，让**指定的那台电脑**去写 | 不替代上面任何一件 |

---

## 5. 视觉规范（不随手写数值）

参考的都是成熟产品的**结构**而不是外观：着陆页按 Linear / Vercel / Stripe 的通行顺序
（导航 → Hero + 产品示意 → 三步 → 能力 → 安全 → 定位对照 → CTA → 页脚），
控制台按 GitHub Settings / Linear 的通行结构（左侧固定导航 + 右侧标题、统计、表格）。
数值全部落成令牌，新增页面只能从下面这些档位里取：

| 类别 | 允许值 | 用途 |
|---|---|---|
| 间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 | 全站唯一间距体系（4 的倍数） |
| 圆角 | 14 / 10 / 6 | 容器 / 控件 / 徽标，外大内小 |
| 字号 | 40 / 22 / 16 / 14 / 13 / 12 | Hero / 区块标题 / 卡片标题 / 正文 / 辅助 / 元信息 |
| 字重 | 400 / 600 | 正文 / 强调，一页不超过两个 |
| 描边 | `rgba(255,255,255,.10)`、`.18` | 分层靠 1px 描边，不用重阴影 |
| 主色 | `#4c9aff` | 只用于主操作与状态，不做渐变文字 |

布局宽度：容器 1120px、导航 56px、控制台侧栏 216px、控制台内容 1040px。
组件规则：

- 按钮 32px 高（鼠标）/ 40px（触控），文字必须完整包在按钮里；
- 表格只用 1px 下边线、不加斑马纹，数字列 `tabular-nums` 右对齐；
- 空状态 = 32px 图标 + 一句"现状" + 一句"下一步"，不写「暂无数据」；
- 状态用「圆点 + 文字」，不靠颜色单独表达；
- 焦点环 2px + 2px 偏移，页首有跳过导航，`prefers-reduced-motion` 下关掉所有过渡。

## 6. 还没做的（明确记下来，避免以后误以为已有）

| 事项 | 为什么先不做 | 什么时候做 |
|---|---|---|
| 定价页与在线支付 | 没有账单系统，自托管是当前唯一形态 | 有托管版再谈 |
| GitHub OAuth | 飞书已经能满足自用与企业内网；国内访问 GitHub 不稳 | 面向海外公开注册时 |
| 多组织切换 | 现在一个会话只服务一个组织，够用 | 出现"一个人在两个组织"的真实需求时 |
| 公开文档站 | `docs/` 在仓库里够用，避免两份文档不同步 | 对外发布时用 docs 生成器 |
| 控制台里新建设备 | 频道密钥只存在设备上，服务端无法生成配对信息 | 不做（会让端到端加密名存实亡） |
