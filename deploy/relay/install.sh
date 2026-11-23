#!/usr/bin/env bash
#
# PlaitCode 中继 · 一键部署
#
# 适用：Ubuntu 22.04 / 24.04 / 26.04，x86_64 或 arm64，root 身份。
# 做的事：装 Node（锁版本到 /opt）→ 建专用用户 → 装 systemd 服务 →
#         nginx 反代 → Let's Encrypt 自动 HTTPS → 日志上限 → 自检。
#
# 用法（服务器上）：
#   curl -fsSL https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay/install.sh -o /tmp/plaitcode-install.sh
#   bash /tmp/plaitcode-install.sh
#
# 可覆盖的变量：
#   PLAITCODE_DOMAIN=plaitcode.com  PLAITCODE_EMAIL=admin@plaitcode.com  PLAITCODE_PORT=8787
#
set -euo pipefail

DOMAIN="${PLAITCODE_DOMAIN:-plaitcode.com}"
EMAIL="${PLAITCODE_EMAIL:-admin@plaitcode.com}"
PORT="${PLAITCODE_PORT:-8787}"
NODE_VERSION="${PLAITCODE_NODE:-22.11.0}"
RAW="${PLAITCODE_RAW:-https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay}"
APP_DIR=/opt/plaitcode-relay
DATA_DIR=/var/lib/plaitcode-relay
NODE_DIR=/opt/node
SERVICE=plaitcode-relay
SERVICE_USER=plaitcode
NGINX_CONF=/etc/nginx/sites-available/plaitcode.conf

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m   ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m   ! %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!! %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo -i 然后再执行本脚本"

step "0/8 前置检查"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ok "系统 ${PRETTY_NAME}" ;;
  *) die "只支持 Ubuntu / Debian，当前是 ${PRETTY_NAME:-$ID}" ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) die "不支持的架构：$ARCH" ;;
esac
ok "架构 $ARCH（Node 用 $NODE_ARCH 包）"

step "1/8 安装基础软件"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils nginx certbot python3-certbot-nginx >/dev/null
ok "nginx / certbot / curl 就绪"

step "2/8 安装 Node ${NODE_VERSION}（不动系统 apt 源）"
if [ -x "$NODE_DIR/bin/node" ]; then
  ok "已存在：$("$NODE_DIR/bin/node" -v)"
else
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o "$TMP/node.tar.xz" \
    || die "下载 Node 失败（检查服务器出网）"
  mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/node.tar.xz" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP"
  ok "已安装：$("$NODE_DIR/bin/node" -v)"
fi

step "3/8 建专用用户与目录"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
ok "用户 $SERVICE_USER / 数据目录 $DATA_DIR"

step "4/8 下载中继程序"
curl -fsSL "$RAW/server.cjs" -o "$APP_DIR/server.cjs" || die "下载 server.cjs 失败（仓库是否公开？路径是否对？）"
chown root:root "$APP_DIR/server.cjs"
chmod 0644 "$APP_DIR/server.cjs"
ok "已就位：$APP_DIR/server.cjs（$(wc -c < "$APP_DIR/server.cjs") 字节）"

step "5/8 装 systemd 服务"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=PlaitCode relay (E2E message relay)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=PLAITCODE_PORT=${PORT}
Environment=PLAITCODE_HOST=127.0.0.1
Environment=NODE_ENV=production
ExecStart=${NODE_DIR}/bin/node ${APP_DIR}/server.cjs
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 1
systemctl is-active "$SERVICE" >/dev/null || die "服务没起来，看日志：journalctl -u $SERVICE -n 50 --no-pager"
ok "服务运行中（127.0.0.1:${PORT}）"
curl -fsS "http://127.0.0.1:${PORT}/health" || die "本机自检失败：journalctl -u $SERVICE -n 50 --no-pager"
echo

step "6/8 配置 nginx 反向代理"
cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN} relay.${DOMAIN};

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # 长轮询最多挂 25 秒，读超时必须比它大
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }
}
NGINX
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/plaitcode.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null || die "nginx 配置有误：nginx -t"
systemctl reload nginx
ok "nginx 已反代 ${DOMAIN} → 127.0.0.1:${PORT}"

step "7/8 申请 HTTPS 证书"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  ok "证书已存在，跳过申请"
else
  certbot --nginx \
    -d "${DOMAIN}" -d "www.${DOMAIN}" -d "relay.${DOMAIN}" \
    --non-interactive --agree-tos -m "$EMAIL" --redirect \
    || die "证书申请失败（确认 80 端口对外开放、DNS 已指向本机）"
  ok "证书已签发"
fi
systemctl enable --now certbot.timer >/dev/null 2>&1 || true
ok "自动续期已启用（certbot.timer）"

step "8/8 限制日志占用并做最终自检"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/plaitcode.conf <<JOURNAL
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=100M
JOURNAL
systemctl restart systemd-journald || true
ok "journald 上限 200M"

printf '\n'
if curl -fsS "https://${DOMAIN}/health"; then
  printf '\n'
  ok "HTTPS 自检通过"
else
  printf '\n'
  warn "HTTPS 自检失败，但服务本身可能在跑。依次检查："
  warn "  1) nginx -t && systemctl status nginx"
  warn "  2) systemctl status ${SERVICE}"
  warn "  3) 安全组是否放开 80/443"
  warn "  4) dig ${DOMAIN} +short 是否等于本机公网 IP"
fi

printf '\n\033[1;32m部署完成。\033[0m\n'
echo "  中继地址：https://${DOMAIN}"
echo "  健康检查：https://${DOMAIN}/health"
echo "  服务日志：journalctl -u ${SERVICE} -f"
echo "  下一步：在 VS Code 里执行「PlaitCode: 新建跨网频道」，地址填 https://${DOMAIN}"
