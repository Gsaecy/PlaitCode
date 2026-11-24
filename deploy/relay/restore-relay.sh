#!/usr/bin/env bash
# 在【新服务器】上还原中继：装依赖 → 恢复备份 → 起服务 → 自检。
#
#   bash restore-relay.sh /root/plaitcode-relay-backup-XXXX.tar.gz
#
# 它自己不会申请证书 —— 证书从备份里恢复。所以**新机器不需要 DNS 已经切过来**
# 就能先把服务跑起来，等验证通过再切 DNS，中断时间最短。
#
# 兼容 Ubuntu / Debian / CentOS / Alibaba Cloud Linux。

set -euo pipefail

ARCHIVE="${1:-}"
SERVICE="${SERVICE:-plaitcode-relay}"
APP_DIR="${APP_DIR:-/opt/plaitcode-relay}"
NODE_VERSION="${NODE_VERSION:-22.11.0}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[33m!\033[0m %s\n' "$*"; }
die() { printf '   \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行（或 sudo bash $0）"
[ -n "$ARCHIVE" ] || die "用法：bash restore-relay.sh /root/plaitcode-relay-backup-XXXX.tar.gz"
[ -f "$ARCHIVE" ] || die "找不到备份文件：$ARCHIVE"

# ---------- 1. 校验备份 ----------

say "1/6 校验备份"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar xzf "$ARCHIVE" -C "$WORK" 2>/dev/null || die "备份解不开，确认是 export-relay.sh 生成的包"
META="$(find "$WORK" -name '*.meta.txt' | head -1)"
[ -n "$META" ] || die "备份里没有迁移清单（*.meta.txt），可能不是本工具的产物"

meta() { sed -n "s/^$1=//p" "$META" | head -1; }
OLD_SERVICE="$(meta SERVICE)"
OLD_DATA="$(meta DATA_ROOT)"
PUBLIC_URL="$(meta PUBLIC_URL)"
ok "来源域名：${PUBLIC_URL:-未知}"
ok "数据目录：${OLD_DATA:-未知}"

# ---------- 2. 装基础环境 ----------

say "2/6 安装 nginx 与解包工具"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq nginx curl ca-certificates tar xz-utils openssl cron >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q nginx curl ca-certificates tar xz openssl cronie >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q nginx curl ca-certificates tar xz openssl cronie >/dev/null
else
  die "认不出包管理器（apt/dnf/yum 都没有）"
fi
ok "nginx / curl / openssl 就绪"

say "3/6 检查 Node"
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -ge 20 ]; then
  ok "已有 Node $(node -v)"
else
  NODE_ARCH="x64"; [ "$(uname -m)" = "aarch64" ] && NODE_ARCH="arm64"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o "$TMP/node.tar.xz" \
    || die "下载 Node 失败"
  mkdir -p /opt/node
  tar xJf "$TMP/node.tar.xz" -C /opt/node --strip-components=1
  rm -rf "$TMP"
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ok "已安装 Node $(/opt/node/bin/node -v)"
fi

# ---------- 4. 恢复文件 ----------

say "4/6 恢复配置与数据"
# 打包时带了绝对路径，直接按原路径解开即可；用 --strip 会破坏 systemd 单元
tar xzf "$ARCHIVE" -C / 2>/dev/null || die "还原失败"

[ -f "${APP_DIR}/server.cjs" ] || warn "${APP_DIR}/server.cjs 不存在，稍后单独下载"

# systemd 单元本体可能没在包里（备份只含 drop-in），补一个最小单元
UNIT="/etc/systemd/system/${SERVICE}.service"
if [ ! -f "$UNIT" ]; then
  NODE_BIN="$(command -v node)"
  cat > "$UNIT" <<EOF
[Unit]
Description=PlaitCode relay
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/server.cjs
Restart=always
RestartSec=3
Environment=PLAITCODE_PORT=8787
Environment=PLAITCODE_HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
EOF
  ok "已生成 systemd 单元"
else
  ok "systemd 单元已从备份恢复"
fi

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true

# ---------- 5. 起服务 ----------

say "5/6 启动服务"
systemctl restart "$SERVICE"
sleep 3
systemctl is-active --quiet "$SERVICE" || {
  journalctl -u "$SERVICE" -n 30 --no-pager | tail -20
  die "服务没起来，看上面的日志"
}
ok "服务在跑"

PORT="$(systemctl cat "$SERVICE" 2>/dev/null | sed -n 's/.*PLAITCODE_PORT=\([0-9]*\).*/\1/p' | head -1)"
PORT="${PORT:-8787}"
HEALTH="$(curl -fsS -m 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
if [ -n "$HEALTH" ]; then ok "健康检查：$HEALTH"; else warn "健康检查没通过（端口 ${PORT}）"; fi

if systemctl cat "$SERVICE" 2>/dev/null | grep -q 'PLAITCODE_GITHUB_CLIENT_ID'; then
  ok "GitHub 登录配置已恢复"
else
  warn "备份里没有 GitHub 配置，需要在 drop-in 里补"
fi

if journalctl -u "$SERVICE" -n 40 --no-pager | grep -q 'GitHub 登录已启用'; then
  ok "GitHub 登录已启用"
fi

# ---------- 6. 下一步 ----------

say "6/6 接下来"
cat <<EOF

服务已经在本机跑起来了（还没对外）。

按这个顺序收尾：

1) 确认 nginx 转发到了中继：
     nginx -t && systemctl reload nginx
     curl -fsS -H "Host: ${PUBLIC_URL#https://}" http://127.0.0.1/health

2) 把 DNS 的 A 记录改成这台机器的公网 IP

3) 等 DNS 生效后，从外部验证：
     curl -fsS ${PUBLIC_URL}/health

4) 验证成功后，再回旧机器释放实例

⚠️ 证书是从备份恢复的，别在新机器上重新申请 —— 同一域名两边同时续期会打架。
EOF
