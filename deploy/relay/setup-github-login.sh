#!/usr/bin/env bash
# 给中继开启 GitHub 登录（部署方执行一次；之后所有用户都不用再碰服务器）
#
# 用法：
#   bash setup-github-login.sh
#   或非交互：DOMAIN=plaitcode.com CLIENT_ID=xxx CLIENT_SECRET=yyy bash setup-github-login.sh
#
# 它只做四件事：写一个独立的 drop-in（不覆盖你已有的 override.conf）、
# 生成会话密钥、重启服务、自检。

set -euo pipefail

SERVICE="${SERVICE:-plaitcode-relay}"
DROPIN_DIR="/etc/systemd/system/${SERVICE}.service.d"
DROPIN="${DROPIN_DIR}/10-github-login.conf"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '   \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行（或 sudo bash $0）"

# ---------- 1. 收集参数 ----------

DOMAIN="${DOMAIN:-}"
CLIENT_ID="${CLIENT_ID:-}"
CLIENT_SECRET="${CLIENT_SECRET:-}"

if [ -z "$DOMAIN" ]; then
  # 尽量从已有配置里读，避免用户重复输入
  DOMAIN="$(systemctl cat "$SERVICE" 2>/dev/null | sed -n 's/.*PLAITCODE_PUBLIC_URL=https\?:\/\/\([^ "]*\).*/\1/p' | head -1 || true)"
fi
[ -n "$DOMAIN" ] || DOMAIN="plaitcode.com"
if [ -z "${CLIENT_ID}" ]; then
  read -r -p "域名 [$DOMAIN]: " input; DOMAIN="${input:-$DOMAIN}"
  DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/}"
  read -r -p "GitHub OAuth App 的 Client ID: " CLIENT_ID
  read -r -p "Client Secret（输入时不显示）: " -s CLIENT_SECRET; echo
fi
[ -n "$CLIENT_ID" ] || die "Client ID 不能为空"
[ -n "$CLIENT_SECRET" ] || die "Client Secret 不能为空"

say "1/4 检查回调地址"
echo "   到 GitHub 上确认这个地址完全一致（少一个字符都会 redirect_uri_mismatch）："
echo "   https://${DOMAIN}/v1/auth/github/callback"

# ---------- 2. 生成会话密钥（已有就复用） ----------

say "2/4 准备会话签名密钥"
AUTH_SECRET="$(systemctl cat "$SERVICE" 2>/dev/null | sed -n 's/.*PLAITCODE_AUTH_SECRET=\([^ "]*\).*/\1/p' | head -1 || true)"
if [ -n "$AUTH_SECRET" ]; then
  ok "沿用已有 PLAITCODE_AUTH_SECRET"
else
  AUTH_SECRET="$(openssl rand -hex 32)"
  ok "已生成新的 PLAITCODE_AUTH_SECRET"
fi

IDENTITY_PATH="$(systemctl cat "$SERVICE" 2>/dev/null | sed -n 's/.*PLAITCODE_IDENTITY=\([^ "]*\).*/\1/p' | head -1 || true)"
IDENTITY_PATH="${IDENTITY_PATH:-/var/lib/plaitcode-relay/identity.json}"

# ---------- 3. 写独立 drop-in ----------

say "3/4 写入 $DROPIN"
mkdir -p "$DROPIN_DIR"
cat > "$DROPIN" <<EOF
# 由 setup-github-login.sh 生成。删掉本文件并 restart 即可关闭 GitHub 登录。
[Service]
Environment=PLAITCODE_IDENTITY=${IDENTITY_PATH}
Environment=PLAITCODE_PUBLIC_URL=https://${DOMAIN}
Environment=PLAITCODE_GITHUB_CLIENT_ID=${CLIENT_ID}
Environment=PLAITCODE_GITHUB_CLIENT_SECRET=${CLIENT_SECRET}
Environment=PLAITCODE_AUTH_SECRET=${AUTH_SECRET}
EOF
chmod 600 "$DROPIN"
ok "已写入（权限 600，因为里面有 secret）"

mkdir -p "$(dirname "$IDENTITY_PATH")"
chown -R "$(systemctl show -p User --value "$SERVICE" 2>/dev/null || echo root)": \
  "$(dirname "$IDENTITY_PATH")" 2>/dev/null || true

systemctl daemon-reload
systemctl restart "$SERVICE"
sleep 2

# ---------- 4. 自检 ----------

say "4/4 自检"
if ! systemctl is-active --quiet "$SERVICE"; then
  journalctl -u "$SERVICE" -n 30 --no-pager | tail -20
  die "服务没起来，看上面的日志"
fi
ok "服务在跑"

PORT="$(systemctl cat "$SERVICE" 2>/dev/null | sed -n 's/.*PLAITCODE_PORT=\([0-9]*\).*/\1/p' | head -1 || true)"
PORT="${PORT:-8787}"
if curl -fsS -m 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  ok "本机健康检查通过"
else
  echo "   ! 本机健康检查没通过，检查 PLAITCODE_PORT（当前猜的是 ${PORT}）"
fi

if journalctl -u "$SERVICE" -n 50 --no-pager | grep -q 'GitHub 登录已启用'; then
  ok "GitHub 登录已启用"
else
  echo "   ! 日志里没看到「GitHub 登录已启用」，最近几行："
  journalctl -u "$SERVICE" -n 10 --no-pager | tail -6
fi

echo
echo "完成。接下来："
echo "  1. 在 VS Code 里执行「PlaitCode: 开始协作（GitHub 登录）」"
echo "  2. 浏览器里用 GitHub 授权一次"
echo "  第二台电脑执行同一个命令就会自动加入；用户不需要碰服务器。"
echo
echo "想关掉：rm -f $DROPIN && systemctl daemon-reload && systemctl restart $SERVICE"
