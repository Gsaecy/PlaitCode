#!/usr/bin/env bash
#
# 在服务器上装 Hysteria2（与新加坡那台同款方案）。
#
# 为什么用 HY2 而不是 HTTP 代理：
#  - 走 UDP + QUIC，抗丢包，弱网下比 TCP 代理稳得多；
#  - 自带混淆（salamander），握手不暴露协议特征；
#  - 客户端 Clash 原生支持，不需要在系统里填代理。
#
# 与网页服务共存：HY2 占 **UDP** 443，nginx 占 **TCP** 443，两者不冲突。
#
# 用法：
#   bash setup-hysteria2.sh
# 可选环境变量：
#   HY2_PORT     监听端口（默认 443/UDP）
#   HY2_AUTH     客户端密码（不填自动生成）
#   HY2_OBFS     混淆密码（不填自动生成）
#   HY2_SNI      伪装域名（默认 www.bing.com，与客户端 sni 一致即可）
#
set -euo pipefail

PORT="${HY2_PORT:-443}"
AUTH="${HY2_AUTH:-}"
OBFS="${HY2_OBFS:-}"
SNI="${HY2_SNI:-www.bing.com}"
CERT_DIR=/etc/hysteria

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m   ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m   ! %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!! %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行"

if [ -z "$AUTH" ]; then
  AUTH="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-22)"
  warn "自动生成连接密码（下面会打印）"
fi
if [ -z "$OBFS" ]; then
  OBFS="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-28)"
  warn "自动生成混淆密码（下面会打印）"
fi

step "1/6 检查 UDP ${PORT} 是否已被占用"
if ss -lunp 2>/dev/null | awk '{print $5}' | grep -qE ":${PORT}$"; then
  ss -lunp | grep -E ":${PORT}\b" || true
  die "UDP ${PORT} 已被占用，换端口：HY2_PORT=8443 bash $0"
fi
ok "UDP ${PORT} 空闲"

step "2/6 安装 Hysteria2"
if command -v hysteria >/dev/null 2>&1; then
  ok "已安装：$(hysteria version 2>/dev/null | head -1)"
else
  export DEBIAN_FRONTEND=noninteractive
  # 官方安装脚本：装二进制 + systemd 服务
  if ! bash <(curl -fsSL https://get.hy2.sh/) >/dev/null 2>&1; then
    die "官方脚本安装失败。手动装法见 https://v2.hysteria.network/docs/getting-started/"
  fi
  command -v hysteria >/dev/null 2>&1 || die "安装后找不到 hysteria 命令"
  ok "已安装：$(hysteria version 2>/dev/null | head -1)"
fi

step "3/6 生成自签证书（CN=${SNI}）"
mkdir -p "$CERT_DIR"
if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
  ok "证书已存在，跳过"
else
  openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/key.pem" 2>/dev/null
  openssl req -new -x509 -days 3650 -key "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -subj "/CN=${SNI}" 2>/dev/null
  ok "已生成（客户端需要 skip-cert-verify: true，因为这是自签证书）"
fi
# 服务以非 root 用户运行（官方脚本建的是 hysteria 用户）。
# key 若设成 600 且属主是 root，服务会报 "tls.key: permission denied"，
# 所以这里统一把属主改成服务用户、key 给 640。
SVC_USER="$(systemctl show hysteria-server -p User --value 2>/dev/null || true)"
SVC_USER="${SVC_USER:-hysteria}"
if id -u "$SVC_USER" >/dev/null 2>&1; then
  chown -R "$SVC_USER:$SVC_USER" "$CERT_DIR"
  ok "证书属主改为 $SVC_USER"
else
  warn "用户 $SVC_USER 不存在，证书保持 root 属主（若服务以 root 运行则无需处理）"
fi
chmod 640 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"
ok "权限：key 640 / cert 644"

step "4/6 写配置"
cat > "$CERT_DIR/config.yaml" <<CONF
listen: :${PORT}

tls:
  cert: ${CERT_DIR}/cert.pem
  key: ${CERT_DIR}/key.pem

obfs:
  type: salamander
  salamander:
    password: ${OBFS}

auth:
  type: password
  password: ${AUTH}

# 被探测时伪装成一个普通网站，减少被主动识别的概率
masquerade:
  type: proxy
  proxy:
    url: https://${SNI}/
    rewriteHost: true

# 关闭 QUIC 之外的杂项干扰
quic:
  initStreamReceiveWindow: 8388608
  maxStreamReceiveWindow: 8388608
  initConnReceiveWindow: 20971520
  maxConnReceiveWindow: 20971520
CONF
ok "配置已写入 ${CERT_DIR}/config.yaml"

step "5/6 启动服务"
systemctl enable hysteria-server >/dev/null 2>&1 || true
systemctl restart hysteria-server
sleep 2
if systemctl is-active --quiet hysteria-server; then
  ok "hysteria-server 运行中"
else
  journalctl -u hysteria-server -n 30 --no-pager
  die "服务启动失败，看上面的日志"
fi
ss -lunp 2>/dev/null | grep -E ":${PORT}\b" || warn "没看到 UDP ${PORT} 监听，检查日志"
ok "UDP ${PORT} 已监听"

step "6/6 放行本机防火墙"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/udp" >/dev/null && ok "ufw 放行 ${PORT}/udp"
else
  ok "本机没开 ufw，跳过"
fi

PUBLIC_IP="$(curl -s --max-time 5 https://api.ipify.org || true)"
# 端口与密码以磁盘上的配置为准：重跑脚本时若沿用旧配置，密码可能与本进程变量不同
CFG_AUTH="$(awk '/^auth:/{f=1;next} f&&/password:/{gsub(/.*password:[[:space:]]*/,"");print;exit}' "$CERT_DIR/config.yaml")"
CFG_OBFS="$(awk '/obfs:/{f=1} f&&/password:/{gsub(/.*password:[[:space:]]*/,"");print;exit}' "$CERT_DIR/config.yaml")"
cat <<SUMMARY

────────────────────────────────────────
Hysteria2 已就绪
────────────────────────────────────────
  服务器   ${PUBLIC_IP:-'<公网IP>'}
  端口     ${PORT}  （UDP）
  密码     ${CFG_AUTH:-$AUTH}
  混淆     salamander / ${CFG_OBFS:-$OBFS}
  SNI      ${SNI}

  * 两个密码只显示这一次，请立刻保存。

把下面这段加到 Clash 配置的 proxies: 下（值已填好）：

  - name: "🇭🇰 香港自建 HY2"
    type: hysteria2
    server: ${PUBLIC_IP:-'<公网IP>'}
    port: ${PORT}
    password: "${CFG_AUTH:-$AUTH}"
    obfs: salamander
    obfs-password: "${CFG_OBFS:-$OBFS}"
    sni: ${SNI}
    skip-cert-verify: true
    up: "40 Mbps"
    down: "80 Mbps"

⚠ 还必须在云控制台放行：安全组 → 入方向 → **UDP ${PORT}**
  （注意是 UDP，不是 TCP。你之前只放行了 TCP 443，那对 HY2 无效。）
────────────────────────────────────────
SUMMARY
