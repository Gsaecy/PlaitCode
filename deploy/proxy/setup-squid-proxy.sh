#!/usr/bin/env bash
#
# 在香港/境外服务器上装一个带认证的 HTTP 代理（Squid）。
#
# 用途：让手机、其它电脑走这台服务器出网，从而能访问境内直连不通的站点
# （例如本项目的 plaitcode.com 中继）。
#
# 设计取舍：
#  - 用 HTTP 代理而不是 SOCKS：iOS / Android 的 WiFi 设置里都能直接填 HTTP 代理，
#    不需要装任何客户端 App。这是"其它设备也能连"的最低门槛。
#  - 必须带认证：开放代理会在几小时内被扫到并当成跳板，轻则流量跑光，重则封机器。
#  - 禁止访问内网/本机网段：防止被用来探测服务器所在内网。
#  - 关闭缓存：代理别人的东西不落盘，减少隐私与磁盘风险。
#
# 已知限制：HTTP 代理的认证是明文 base64，链路上可被嗅探。
# 所以要：密码够长、端口别用 3128、有条件就限制来源 IP。
#
# 用法：
#   PROXY_USER=me PROXY_PASS='自己定一个长密码' bash setup-squid-proxy.sh
# 可选环境变量：
#   PROXY_PORT   监听端口（默认 38080，故意避开 3128 这个扫描器最爱）
#   PROXY_ALLOW  逗号分隔的来源网段，默认 0.0.0.0/0（全部）
#
set -euo pipefail

PORT="${PROXY_PORT:-38080}"
USER_NAME="${PROXY_USER:-plaitcode}"
PASS="${PROXY_PASS:-}"
ALLOW="${PROXY_ALLOW:-0.0.0.0/0}"

step() { printf "\n\033[1;36m== %s ==\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m   ✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m   ! %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m!! %s\033[0m\n" "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo -i 然后再执行"

if [ -z "$PASS" ]; then
  PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  warn "没提供 PROXY_PASS，已随机生成一个（下面会打印一次，请立刻保存）"
fi
[ "${#PASS}" -ge 12 ] || die "密码至少 12 位"

step "1/6 安装 squid 与 htpasswd 工具"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Ubuntu 24.04 起 squid 被拆包，某些镜像里只有 squid-openssl；两个都试一遍
if ! apt-get install -y -qq squid apache2-utils >/dev/null 2>&1; then
  warn "装 squid 失败，尝试 squid-openssl"
  apt-get install -y -qq squid-openssl apache2-utils >/dev/null 2>&1 \
    || die "squid 安装失败，请手动执行：apt-get install -y squid apache2-utils"
fi
command -v squid >/dev/null 2>&1 || die "squid 可执行文件不存在，安装似乎没成功"
ok "已安装 squid"

step "2/6 写认证文件"
mkdir -p /etc/squid
htpasswd -bc /etc/squid/passwd "$USER_NAME" "$PASS" >/dev/null 2>&1
chown root:proxy /etc/squid/passwd 2>/dev/null || chown root:root /etc/squid/passwd
chmod 640 /etc/squid/passwd
ok "用户 $USER_NAME 已写入 /etc/squid/passwd（权限 640）"

step "3/6 生成最小化配置"
NCSA=""
for candidate in /usr/lib/squid/basic_ncsa_auth /usr/lib64/squid/basic_ncsa_auth /usr/libexec/squid/basic_ncsa_auth; do
  if [ -x "$candidate" ]; then NCSA="$candidate"; break; fi
done
[ -n "$NCSA" ] || die "找不到 basic_ncsa_auth，无法启用认证"
ok "认证程序：$NCSA"

cat > /etc/squid/squid.conf <<CONF
# 由 deploy/proxy/setup-squid-proxy.sh 生成。改完记得 systemctl reload squid。
http_port ${PORT}

# 认证：只有给出正确用户名密码的客户端才能用
auth_param basic program ${NCSA} /etc/squid/passwd
auth_param basic realm PlaitCode proxy
auth_param basic credentialsttl 8 hours
acl authenticated proxy_auth REQUIRED

# 只允许标准端口出网，避免被当成任意端口扫描跳板
acl SSL_ports port 443 8443
acl Safe_ports port 80 443 8080 8443
acl CONNECT method CONNECT

# 禁止访问本机与内网网段：防止被拿来做内网探测
acl to_localhost dst 127.0.0.0/8 ::1
acl to_private dst 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16
acl allow_src src ${ALLOW}

http_access deny to_localhost
http_access deny to_private
http_access deny !Safe_ports
http_access deny CONNECT !SSL_ports
http_access allow allow_src authenticated
http_access deny all

# 不缓存任何东西：代理别人的流量不该在服务器上留副本
cache deny all
access_log /var/log/squid/access.log
coredump_dir /var/spool/squid

# 转发时不暴露来源信息
via off
forwarded_for delete
request_header_access X-Forwarded-For deny all
CONF
ok "配置已写入（端口 ${PORT}，来源 ${ALLOW}）"

step "4/6 启动并设置开机自启"
systemctl enable squid >/dev/null 2>&1 || true
systemctl restart squid
sleep 2
systemctl is-active --quiet squid || { journalctl -u squid -n 20 --no-pager; die "squid 启动失败"; }
ok "squid 运行中"

step "5/6 自检"
if curl -s -x "http://127.0.0.1:${PORT}" -U "${USER_NAME}:${PASS}" --max-time 20 \
     https://plaitcode.com/health -o /dev/null -w "" 2>/dev/null; then
  ok "经本机代理可访问 https://plaitcode.com/health"
else
  warn "访问 plaitcode.com 未通过（可能是目标站点或本机出网问题，代理本身可能没问题）"
fi
if curl -s -x "http://127.0.0.1:${PORT}" --max-time 8 https://example.com -o /dev/null -w "" 2>/dev/null; then
  warn "未带认证也能通 —— 请检查 http_access 顺序（不该发生）"
else
  ok "未认证请求被拒绝（符合预期）"
fi

step "6/6 放行防火墙"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null && ok "ufw 已放行 ${PORT}/tcp"
else
  ok "本机没开 ufw，跳过"
fi

PUBLIC_IP="$(curl -s --max-time 5 https://api.ipify.org || true)"
cat <<SUMMARY

────────────────────────────────────────
代理已就绪
────────────────────────────────────────
  地址   ${PUBLIC_IP:-'<服务器公网IP>'}
  端口   ${PORT}
  用户   ${USER_NAME}
  密码   ${PASS}
  类型   HTTP 代理（支持 CONNECT，可代理 HTTPS）

  * 密码只显示这一次，请立刻存进密码管理器。

设备怎么填：
  iPhone   设置 → 无线局域网 → 当前 WiFi 右侧 (i) → 配置代理 → 手动
           服务器 = 上面的地址，端口 = ${PORT}，打开「鉴定」填用户名/密码
  Android  WiFi 长按 → 修改网络 → 高级选项 → 代理 → 手动
  Windows  设置 → 网络和 Internet → 代理 → 手动设置代理

还需要在阿里云控制台放行：
  安全组 → 入方向 → 添加 TCP ${PORT}（来源建议填自己的常用 IP 段，而不是 0.0.0.0/0）

验证命令：
  curl -x http://${USER_NAME}:${PASS}@${PUBLIC_IP:-'<IP>'}:${PORT} https://plaitcode.com/health
────────────────────────────────────────
SUMMARY
