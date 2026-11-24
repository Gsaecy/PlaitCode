#!/usr/bin/env bash
# 在**已有其它站点**的服务器上部署 PlaitCode 中继。
#
#   PLAITCODE_DOMAIN=plaitcode.com PLAITCODE_EMAIL=you@example.com bash install-shared-host.sh
#
# 与 install-portable.sh 的区别（这是它存在的理由）：
#   1. 证书用 **webroot**，不用 --standalone —— standalone 会临时抢 80 端口，
#      把现有站点打断；webroot 完全不停 nginx。
#   2. 只**新增**一个 vhost 文件，不删、不改任何现有配置（含 default）。
#   3. 每一步失败都回滚：删掉刚写的文件，nginx 恢复原状。
#   4. 动手前先探测：现有的 server_name、80/443 占用情况、是否已有同名 vhost。
#
# 什么时候用它：服务器上已经跑着别的网站。
# 干净的新机器用 install-portable.sh 更省事。

set -euo pipefail

DOMAIN="${PLAITCODE_DOMAIN:-plaitcode.com}"
EMAIL="${PLAITCODE_EMAIL:-admin@${DOMAIN}}"
PORT="${PLAITCODE_PORT:-8787}"
NODE_VERSION="${PLAITCODE_NODE:-22.11.0}"
RAW="${PLAITCODE_RAW:-https://raw.githubusercontent.com/Gsaecy/PlaitCode/main/deploy/relay}"
SERVICE=plaitcode-relay
APP_DIR=/opt/plaitcode-relay
DATA_DIR=/var/lib/plaitcode-relay
WEBROOT=/var/www/plaitcode-acme
VHOST=/etc/nginx/conf.d/99-plaitcode.conf
CERT_DIR=/etc/nginx/ssl/plaitcode

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[33m!\033[0m %s\n' "$*"; }
die() { printf '   \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行（或 sudo bash $0）"

# 回滚：任何失败都撤掉我们加的 vhost，让 nginx 回到原样
CREATED_VHOST=0
rollback() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$CREATED_VHOST" -eq 1 ]; then
    printf '\n\033[33m!! 中途失败，正在回滚…\033[0m\n'
    rm -f "$VHOST"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
    systemctl stop "$SERVICE" >/dev/null 2>&1 || true
    systemctl disable "$SERVICE" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${SERVICE}.service"
    systemctl daemon-reload >/dev/null 2>&1 || true
    printf '   已删除 %s，nginx 保持原状。现有站点不受影响。\n' "$VHOST"
  fi
  exit "$code"
}
trap rollback EXIT

# ---------- 1. 探测现有环境 ----------

say "1/7 探测现有环境"
command -v nginx >/dev/null 2>&1 || die "这台机器没装 nginx。干净机器请用 install-portable.sh"
systemctl is-active --quiet nginx || die "nginx 没在运行。先启动它，或改用 install-portable.sh"
ok "nginx 正在运行"

# 现有站点的域名，用来判断有没有冲突
EXISTING_NAMES="$(nginx -T 2>/dev/null | sed -n 's/^\s*server_name\s\+\(.*\);/\1/p' | tr ' ' '\n' | grep -v '^$' | sort -u || true)"
ok "现有 server_name：$(printf '%s' "$EXISTING_NAMES" | tr '\n' ' ' | sed 's/ $//')"

for name in "$DOMAIN" "www.$DOMAIN"; do
  if printf '%s\n' "$EXISTING_NAMES" | grep -qx "$name"; then
    die "已经有站点在用 server_name=$name。为避免破坏它，这里停下。
   请先确认哪个 vhost 占用了它：nginx -T | grep -n \"server_name.*$name\"
   如果那是你自己配的、可以替换，手动改完再重跑。"
  fi
done
ok "$DOMAIN 没有被其它 vhost 占用"

# 端口占用：只提示，不阻断（nginx 已占用是正常的）
if ss -ltnp 2>/dev/null | grep -q ":${PORT} "; then
  die "端口 ${PORT} 已被占用。用 PLAITCODE_PORT=其它端口 重跑"
fi
ok "端口 ${PORT} 空闲"

# ---------- 2. Node ----------

say "2/7 检查 Node"
if command -v node >/dev/null 2>&1 && [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -ge 20 ]; then
  NODE_BIN="$(command -v node)"
  ok "已有 Node $(node -v)"
else
  NODE_ARCH="x64"; [ "$(uname -m)" = "aarch64" ] && NODE_ARCH="arm64"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o "$TMP/node.tar.xz" || die "下载 Node 失败"
  mkdir -p /opt/node
  tar xJf "$TMP/node.tar.xz" -C /opt/node --strip-components=1
  rm -rf "$TMP"
  NODE_BIN=/opt/node/bin/node
  ln -sf "$NODE_BIN" /usr/local/bin/node
  ok "已安装 Node $("$NODE_BIN" -v)"
fi

# ---------- 3. 程序与数据目录 ----------

say "3/7 安装中继程序"
mkdir -p "$APP_DIR" "$DATA_DIR" "$WEBROOT/.well-known/acme-challenge"
curl -fsSL "$RAW/server.cjs" -o "$APP_DIR/server.cjs" || die "下载 server.cjs 失败"
ok "server.cjs 就绪（$(du -h "$APP_DIR/server.cjs" | cut -f1)）"

INSTALL_ID="$(date +%Y%m%d%H%M%S)"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=PlaitCode relay
After=network.target

[Service]
Type=simple
ExecStart=${NODE_BIN} ${APP_DIR}/server.cjs
WorkingDirectory=${APP_DIR}
Restart=always
RestartSec=3
Environment=PLAITCODE_PORT=${PORT}
Environment=PLAITCODE_HOST=127.0.0.1
Environment=PLAITCODE_AUDIT=${DATA_DIR}/audit.jsonl
Environment=PLAITCODE_HISTORY=${DATA_DIR}/channels
Environment=PLAITCODE_IDENTITY=${DATA_DIR}/identity.json
NoNewPrivileges=true
PrivateTmp=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
for attempt in $(seq 1 20); do
  curl -fsS -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && break
  [ "$attempt" -eq 20 ] && { journalctl -u "$SERVICE" -n 40 --no-pager; die "中继没起来"; }
  sleep 0.5
done
ok "中继运行中（127.0.0.1:${PORT}）"

# ---------- 4. 只新增 vhost（先只开 80，用于 ACME 验证） ----------

say "4/7 新增 vhost（不动现有站点）"
[ -f "$VHOST" ] && { cp -a "$VHOST" "${VHOST}.bak-${INSTALL_ID}"; warn "已存在同名 vhost，备份为 ${VHOST}.bak-${INSTALL_ID}"; }

cat > "$VHOST" <<NGINX
# 由 install-shared-host.sh 生成，只接管 server_name = ${DOMAIN}。
# 本文件以外的一切配置都不修改；删掉本文件即可完全移除 PlaitCode。
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

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
        proxy_buffering off;
    }
}
NGINX
CREATED_VHOST=1

if ! nginx -t 2>&1 | tail -3; then
  die "nginx 配置校验失败（会回滚上面新增的文件）"
fi
systemctl reload nginx
ok "vhost 已加载（HTTP 80）"

# ---------- 5. 用 webroot 申请证书 ----------

say "5/7 申请证书（webroot，不停 nginx）"
if [ -x "$HOME/.acme.sh/acme.sh" ]; then
  ok "acme.sh 已存在"
else
  curl -fsSL https://get.acme.sh | sh -s email="$EMAIL" >/dev/null 2>&1 || die "acme.sh 安装失败"
  ok "acme.sh 已安装"
fi

ACME="$HOME/.acme.sh/acme.sh"
mkdir -p "$CERT_DIR"

# 先确认 80 端口能取到 ACME 文件，否则申请必然失败
echo probe > "${WEBROOT}/.well-known/acme-challenge/probe"
if ! curl -fsS -m 8 "http://${DOMAIN}/.well-known/acme-challenge/probe" >/dev/null 2>&1; then
  warn "外部访问 http://${DOMAIN}/.well-known/acme-challenge/probe 失败"
  warn "通常是 DNS 还没指向本机，或 80 端口被防火墙拦住"
  rm -f "${WEBROOT}/.well-known/acme-challenge/probe"
  die "先让 DNS 生效（dig +short ${DOMAIN} 应为本机公网 IP）再重跑"
fi
rm -f "${WEBROOT}/.well-known/acme-challenge/probe"
ok "ACME 验证路径可达"

if ! "$ACME" --issue -d "$DOMAIN" -d "www.${DOMAIN}" --webroot "$WEBROOT" --keylength ec-256; then
  # www 常常没配解析，退一步只申请主域名
  warn "带 www 的申请失败，改为只申请 ${DOMAIN}"
  "$ACME" --issue -d "$DOMAIN" --webroot "$WEBROOT" --keylength ec-256 || die "证书申请失败（会回滚）"
fi

"$ACME" --install-cert -d "$DOMAIN" --ecc \
  --key-file "${CERT_DIR}/key.pem" \
  --fullchain-file "${CERT_DIR}/cert.pem" \
  --reloadcmd "systemctl reload nginx" >/dev/null || die "证书安装失败（会回滚）"
chmod 640 "${CERT_DIR}/key.pem"
chmod 644 "${CERT_DIR}/cert.pem"
ok "证书已安装到 ${CERT_DIR}"

# ---------- 6. 加 443 ----------

say "6/7 启用 HTTPS"
cat > "$VHOST" <<NGINX
# 由 install-shared-host.sh 生成，只接管 server_name = ${DOMAIN}。
# 本文件以外的一切配置都不修改；删掉本文件即可完全移除 PlaitCode。
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type "text/plain";
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate     ${CERT_DIR}/cert.pem;
    ssl_certificate_key ${CERT_DIR}/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:plaitcode:10m;
    ssl_session_timeout 1h;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
NGINX

if ! nginx -t 2>&1 | tail -3; then
  rm -f "$VHOST"
  die "HTTPS 配置校验失败，已删除新增的 vhost"
fi
systemctl reload nginx
ok "HTTPS 已启用"

# ---------- 7. 自检 ----------

say "7/7 自检"
LOCAL="$(curl -fsS -m 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
[ -n "$LOCAL" ] && ok "本机健康检查：$LOCAL" || warn "本机健康检查失败"

if command -v dig >/dev/null 2>&1; then
  RESOLVED="$(dig +short "$DOMAIN" | tail -1)"
  PUBLIC="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$RESOLVED" ] && ok "DNS $DOMAIN → $RESOLVED ；本机公网 $PUBLIC"
fi

EXTERNAL="$(curl -fsS -m 10 "https://${DOMAIN}/health" 2>/dev/null || true)"
if [ -n "$EXTERNAL" ]; then
  ok "外网可达：$EXTERNAL"
else
  warn "外网访问 https://${DOMAIN}/health 失败（DNS 未生效或防火墙）"
fi

cat <<EOF

完成。PlaitCode 只占用 server_name = ${DOMAIN}，现有站点未受影响。

接下来配 GitHub 登录：
  bash <(curl -fsSL ${RAW}/setup-github-login.sh)

想彻底移除 PlaitCode（其它站点不受影响）：
  systemctl disable --now ${SERVICE}
  rm -f ${VHOST}
  nginx -t && systemctl reload nginx
EOF

trap - EXIT
