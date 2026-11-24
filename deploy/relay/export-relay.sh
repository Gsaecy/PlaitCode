#!/usr/bin/env bash
# 在【旧服务器】上导出中继的全部状态：配置、身份库、频道历史、证书。
#
#   bash export-relay.sh
#
# 产物是一个 tar.gz，里面含 GitHub Client Secret，权限自动设成 600。
# 下载到本地后，在【新服务器】上用 restore-relay.sh 还原。
#
# 它只读不写：不动服务、不动数据，随时可以重跑。

set -euo pipefail

SERVICE="${SERVICE:-plaitcode-relay}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${OUT:-/root/plaitcode-relay-backup-${STAMP}.tar.gz}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '   \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行（或 sudo bash $0）"

# ---------- 1. 从 systemd 里读出真实路径，不猜 ----------

say "1/4 读取当前部署信息"
if ! systemctl cat "$SERVICE" >/dev/null 2>&1; then
  die "找不到 $SERVICE 服务。用 SERVICE=实际服务名 重试"
fi
UNIT_DUMP="$(systemctl cat "$SERVICE")"

EXEC_START="$(printf '%s\n' "$UNIT_DUMP" | sed -n 's/^ExecStart=//p' | tail -1)"
APP_DIR="$(printf '%s\n' "$EXEC_START" | grep -oE '/[^ ]+/server\.cjs' | head -1 | xargs -r dirname)"
[ -n "$APP_DIR" ] || APP_DIR="/opt/plaitcode-relay"
ok "程序目录：$APP_DIR"

DROPIN_DIR="$(systemctl show -p DropInPaths --value "$SERVICE" 2>/dev/null | tr ' ' '\n' | grep . | head -1 | xargs -r dirname || true)"
DROPIN_DIR="${DROPIN_DIR:-/etc/systemd/system/${SERVICE}.service.d}"

IDENTITY_PATH="$(printf '%s\n' "$UNIT_DUMP" | sed -n 's/.*PLAITCODE_IDENTITY=\([^ "]*\).*/\1/p' | head -1)"
HISTORY_DIR="$(printf '%s\n' "$UNIT_DUMP" | sed -n 's/.*PLAITCODE_HISTORY=\([^ "]*\).*/\1/p' | head -1)"
AUDIT_PATH="$(printf '%s\n' "$UNIT_DUMP" | sed -n 's/.*PLAITCODE_AUDIT=\([^ "]*\).*/\1/p' | head -1)"
PUBLIC_URL="$(printf '%s\n' "$UNIT_DUMP" | sed -n 's/.*PLAITCODE_PUBLIC_URL=\([^ "]*\).*/\1/p' | head -1)"

DATA_ROOT=""
if [ -n "$IDENTITY_PATH" ]; then
  DATA_ROOT="$(dirname "$IDENTITY_PATH")"
elif [ -n "$HISTORY_DIR" ] && [ "$HISTORY_DIR" != "-" ]; then
  DATA_ROOT="$(dirname "$HISTORY_DIR")"
else
  DATA_ROOT="/var/lib/plaitcode-relay"
fi
ok "数据目录：$DATA_ROOT"
ok "域名：${PUBLIC_URL:-（未设置）}"

# ---------- 2. 证书目录 ----------

say "2/4 定位证书"
CERT_DIRS=()
for candidate in /etc/letsencrypt /root/.acme.sh /etc/nginx/ssl; do
  [ -d "$candidate" ] && CERT_DIRS+=("$candidate")
done
if [ "${#CERT_DIRS[@]}" -gt 0 ]; then
  ok "证书目录：${CERT_DIRS[*]}"
else
  echo "   ! 没找到常见证书目录（可能用了别的工具，或由反向代理终止 TLS）"
fi

# ---------- 3. 打包 ----------

say "3/4 打包"
PATHS=()
[ -d "$DROPIN_DIR" ] && PATHS+=("$DROPIN_DIR")
[ -d "$DATA_ROOT" ] && PATHS+=("$DATA_ROOT")
[ -d "$APP_DIR" ] && PATHS+=("$APP_DIR")
for dir in "${CERT_DIRS[@]+"${CERT_DIRS[@]}"}"; do PATHS+=("$dir"); done
[ -d /etc/nginx ] && PATHS+=(/etc/nginx)

[ "${#PATHS[@]}" -gt 0 ] || die "没有可打包的内容，检查上面的路径"

# 顺带把结论写成一份清单，新机照着还原即可
META="/root/plaitcode-relay-${STAMP}.meta.txt"
{
  echo "# PlaitCode 中继迁移清单（$(date -Is)）"
  echo "SERVICE=$SERVICE"
  echo "APP_DIR=$APP_DIR"
  echo "DROPIN_DIR=$DROPIN_DIR"
  echo "DATA_ROOT=$DATA_ROOT"
  echo "IDENTITY_PATH=${IDENTITY_PATH:-（未设置）}"
  echo "HISTORY_DIR=${HISTORY_DIR:-（未设置）}"
  echo "AUDIT_PATH=${AUDIT_PATH:-（未设置）}"
  echo "PUBLIC_URL=${PUBLIC_URL:-（未设置）}"
  echo "CERT_DIRS=${CERT_DIRS[*]:-（未找到）}"
  echo
  echo "## 服务单元"
  printf '%s\n' "$UNIT_DUMP"
} > "$META"
PATHS+=("$META")

tar czf "$OUT" --absolute-names "${PATHS[@]}" 2>/dev/null
chmod 600 "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
ok "已生成 $OUT（$SIZE，权限 600）"

# ---------- 4. 下一步 ----------

say "4/4 下一步"
cat <<EOF

这个包里有 GitHub Client Secret 和身份库，**不要上传到公开位置**。

下载到本地（在你自己的电脑上执行）：
  scp root@\$(本机公网IP):${OUT} .

然后传到你【新服务器】：
  scp plaitcode-relay-backup-${STAMP}.tar.gz root@(新服务器IP):/root/

最后在新服务器上还原：
  bash restore-relay.sh /root/plaitcode-relay-backup-${STAMP}.tar.gz

⚠️ 顺序很重要：先在新机器装好并把 DNS 切过去，再释放旧机器。
EOF
