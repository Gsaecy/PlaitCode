#!/usr/bin/env bash
#
# PlaitCode 中继 · 兼容 CentOS / Alibaba Cloud Linux / Ubuntu 的安装脚本。
#
# 与 install.sh 的区别（为什么需要第二个脚本）：
#  1. install.sh 假定 Ubuntu/Debian（apt + sites-available），在 Alibaba Cloud Linux
#     上会直接退出；这台新加坡机器正是后者。
#  2. install.sh 会 `rm -f sites-enabled/default`。如果服务器上已经跑着别的站点，
#     那是破坏性操作。本脚本**只新增 vhost**，不删任何现有配置。
#  3. 证书用 acme.sh（纯 shell，不依赖发行版源）：老系统上 certbot 常常装不上，
#     而 acme.sh 在任何 Linux 上都能跑。
#
# 用法：
#   PLAITCODE_DOMAIN=plaitcode.com PLAITCODE_EMAIL=you@example.com bash install-portable.sh
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
WEBROOT=/var/www/acme

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m   ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m   ! %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!! %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo -i 然后再执行本脚本"

step "0/8 识别系统（apt 还是 dnf/yum，nginx 配置放哪）"
. /etc/os-release
PM=""
if command -v apt-get >/dev/null 2>&1; then PM=apt
elif command -v dnf >/dev/null 2>&1; then PM=dnf
elif command -v yum >/dev/null 2>&1; then PM=yum
else die "既没有 apt 也没有 dnf/yum，未知发行版：${PRETTY_NAME:-$ID}"
fi
ok "系统 ${PRETTY_NAME:-$ID} · 包管理 $PM"

# nginx vhost 目录：RHEL 系是 conf.d（且没有 sites-enabled）
if [ -d /etc/nginx/sites-available ]; then
  NGINX_MODE=debian
  NGINX_CONF=/etc/nginx/sites-available/plaitcode.conf
  NGINX_LINK=/etc/nginx/sites-enabled/plaitcode.conf
else
  NGINX_MODE=rhel
  NGINX_CONF=/etc/nginx/conf.d/plaitcode.conf
  NGINX_LINK=""
fi
ok "nginx 配置模式：$NGINX_MODE → $NGINX_CONF"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) die "不支持的架构：$ARCH" ;;
esac
ok "架构 $ARCH"

step "1/8 安装 nginx / curl / cron"
export DEBIAN_FRONTEND=noninteractive
case "$PM" in
  dnf) dnf install -y -q nginx curl ca-certificates tar xz openssl cronie >/dev/null ;;
  yum) yum install -y -q nginx curl ca-certificates tar xz openssl cronie >/dev/null ;;
  apt) apt-get update -qq; apt-get install -y -qq nginx curl ca-certificates tar xz-utils openssl cron >/dev/null ;;
esac
systemctl enable nginx >/dev/null 2>&1 || true
systemctl start nginx
ok "nginx $(nginx -v 2>&1 | sed 's#.*/##') 就绪"

step "2/8 安装 Node ${NODE_VERSION}（不动系统源）"
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
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /sbin/nologin "$SERVICE_USER" 2>/dev/null \
  || useradd -r -d "$DATA_DIR" -s /sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/channels" "$WEBROOT"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
mkdir -p "$WEBROOT/.well-known/acme-challenge"
ok "用户 $SERVICE_USER / 数据目录 $DATA_DIR"

step "4/8 下载中继程序"
curl -fsSL "$RAW/server.cjs" -o "$APP_DIR/server.cjs" || die "下载 server.cjs 失败"
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
Environment=PLAITCODE_AUDIT=${DATA_DIR}/audit.jsonl
Environment=PLAITCODE_AUDIT_STDOUT=1
Environment=PLAITCODE_HISTORY=${DATA_DIR}/channels
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
for attempt in $(seq 1 20); do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
  [ "$attempt" -eq 20 ] && { journalctl -u "$SERVICE" -n 40 --no-pager; die "服务没起来"; }
  sleep 0.5
done
ok "服务运行中（127.0.0.1:${PORT}）"

step "6/8 配置 nginx（只新增 vhost，不动现有站点）"
cat > "$NGINX_CONF" <<NGINX
# 由 install-portable.sh 生成。只接管 ${DOMAIN} 这个 server_name，
# 其它站点（含默认站点）完全不受影响。
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN} relay.${DOMAIN};

    # ACME 续签用
    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type "text/plain";
    }

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }
}
NGINX

if [ -n "$NGINX_LINK" ]; then
  ln -sf "$NGINX_CONF" "$NGINX_LINK"
else
  # RHEL 的 nginx.conf 才是总入口；conf.d/*.conf 需要被 include 到 server 块之外。
  # 大多数镜像默认有 `include /etc/nginx/conf.d/*.conf;`（在 http 块内），这里确认一下。
  if grep -qE '^\s*include\s+/etc/nginx/conf\.d/\*\.conf;' /etc/nginx/nginx.conf; then
    ok "nginx.conf 已包含 conf.d/*.conf"
  else
    warn "nginx.conf 里没找到 conf.d include，手动加一行到 http { } 内："
    warn '  include /etc/nginx/conf.d/*.conf;'
  fi
fi

nginx -t || die "nginx 配置有误：先看上面提示，修好再继续"
systemctl reload nginx
ok "nginx 已反代 ${DOMAIN} → 127.0.0.1:${PORT}"

step "7/8 申请 HTTPS 证书（acme.sh）"
if [ -f "/etc/nginx/ssl/${DOMAIN}/fullchain.pem" ]; then
  ok "证书已存在，跳过申请"
else
  if [ ! -x "$HOME/.acme.sh/acme.sh" ]; then
    curl -fsSL https://get.acme.sh | sh -s email="$EMAIL" >/dev/null 2>&1 || die "acme.sh 安装失败"
  fi
  ISSUE_OK=0
  # 先试 webroot（nginx 已在 80 端口，不需要停机）
  if "$HOME/.acme.sh/acme.sh" --issue -d "$DOMAIN" -d "www.${DOMAIN}" -w "$WEBROOT" --keylength ec-256 >/dev/null 2>&1; then
    ISSUE_OK=1
  else
    warn "webroot 方式失败，改试 standalone（会短暂占用 80 端口）"
    systemctl stop nginx
    if "$HOME/.acme.sh/acme.sh" --issue -d "$DOMAIN" -d "www.${DOMAIN}" --standalone --keylength ec-256 >/dev/null 2>&1; then
      ISSUE_OK=1
    fi
    systemctl start nginx
  fi
  [ "$ISSUE_OK" -eq 1 ] || die "证书申请失败：确认 ${DOMAIN} 的 A 记录已指向本机公网 IP，且 80 端口对外开放"
  mkdir -p "/etc/nginx/ssl/${DOMAIN}"
  "$HOME/.acme.sh/acme.sh" --install-cert -d "$DOMAIN" --ecc \
    --fullchain-file "/etc/nginx/ssl/${DOMAIN}/fullchain.pem" \
    --key-file "/etc/nginx/ssl/${DOMAIN}/privkey.pem" \
    --reloadcmd "systemctl reload nginx" >/dev/null || die "证书安装失败"
  ok "证书已签发并安装"
fi

# 证书就绪后整份重写 vhost（带 443）。重写而不是打补丁：补丁式改配置很容易在
# 重复执行时叠加出两份 listen 443，nginx -t 才会报错，排查成本高。
cat > "$NGINX_CONF" <<NGINX
# 由 install-portable.sh 生成。只接管 ${DOMAIN} 这个 server_name。
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN} www.${DOMAIN} relay.${DOMAIN};

    ssl_certificate /etc/nginx/ssl/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # ACME 续签用
    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type "text/plain";
    }

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }
}
NGINX
nginx -t || die "加 443 后 nginx 配置有误"
systemctl reload nginx
ok "HTTPS 已启用"

step "8/8 防火墙与最终自检"
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null && firewall-cmd --permanent --add-service=https >/dev/null
  firewall-cmd --reload >/dev/null
  ok "firewalld 已放行 80/443"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ok "ufw 已放行 80/443"
else
  ok "本机防火墙未启用，跳过"
fi

printf '\n'
if curl -fsS --max-time 10 "https://${DOMAIN}/health"; then
  printf '\n'
  ok "HTTPS 自检通过"
else
  printf '\n'
  warn "HTTPS 自检未通过。依次检查："
  warn "  1) nginx -t && systemctl status nginx"
  warn "  2) systemctl status ${SERVICE}"
  warn "  3) 云控制台安全组是否放开 80/443"
  warn "  4) dig ${DOMAIN} +short 是否等于本机公网 IP"
fi

printf '\n\033[1;32m部署完成。\033[0m\n'
echo "  中继地址：https://${DOMAIN}"
echo "  健康检查：https://${DOMAIN}/health"
echo "  服务日志：journalctl -u ${SERVICE} -f"
echo
echo "  已有数据（身份库 / 频道历史）从旧服务器搬过来："
echo "    scp -r 旧服务器:/var/lib/plaitcode-relay/* ${DATA_DIR}/"
echo "    chown -R ${SERVICE_USER}:${SERVICE_USER} ${DATA_DIR}"
echo "    systemctl restart ${SERVICE}"
echo
echo "  提示：本脚本没有改动其它站点，也没有删除默认站点。"
