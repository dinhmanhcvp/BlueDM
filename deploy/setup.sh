#!/usr/bin/env bash
# Cài / cập nhật Blue DM trên VPS Ubuntu 22.04 hoặc 24.04.
# Dùng (trong thư mục dự án):  sudo bash deploy/setup.sh tenmien.vn
# Chạy lại bao nhiêu lần cũng được: dữ liệu (data/) và khoá (.env) được giữ nguyên.
set -euo pipefail
DOMAIN="${1:?Thiếu tên miền. Dùng: sudo bash deploy/setup.sh tenmien.vn}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
[ "$(id -u)" = 0 ] || { echo "Cần chạy bằng sudo"; exit 1; }

echo "==> Node.js 22"
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Caddy (tự cấp HTTPS)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "==> Thư viện"
command -v pm2 >/dev/null || npm i -g pm2
npm ci --omit=dev

echo "==> Khoá bí mật (tạo 1 lần, KHÔNG đổi SESSION_KEY về sau: đổi là mọi tài xế phải quét QR lại)"
if [ ! -f .env ]; then
  printf 'ADMIN_KEY=%s\nSESSION_KEY=%s\nTZ=Asia/Ho_Chi_Minh\nPORT=3000\nHOST=127.0.0.1\n' \
    "$(openssl rand -hex 10)" "$(openssl rand -hex 32)" > .env
fi
chmod 600 .env
mkdir -p data && chmod 700 data

echo "==> Chạy nền, tự bật lại khi VPS khởi động lại"
pm2 delete bluedm >/dev/null 2>&1 || true
pm2 start server.js --name bluedm --node-args="--env-file=.env"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null

echo "==> HTTPS cho $DOMAIN"
printf '%s {\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> Tường lửa (chỉ mở SSH, HTTP, HTTPS)"
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null; fi

echo "==> Sao lưu data/ lúc 3h sáng mỗi ngày, giữ 7 bản xoay vòng theo thứ"
( crontab -l 2>/dev/null | grep -v bluedm-backup
  echo "0 3 * * * tar -czf /root/bluedm-backup-\$(date +\\%u).tgz -C $APP_DIR data .env # bluedm-backup" ) | crontab -

sleep 2
if curl -fsS -o /dev/null http://127.0.0.1:3000/landmarks; then echo "✓ App đang chạy"; else echo "✗ App chưa chạy, xem: pm2 logs bluedm"; exit 1; fi
cat <<EOF

=====================================================
 App tài xế : https://$DOMAIN
 Trang admin: https://$DOMAIN/admin.html
 Mật khẩu admin: $(grep ^ADMIN_KEY .env | cut -d= -f2)
 (Lưu mật khẩu này lại. Xem lại: cat $APP_DIR/.env)
 Xem log    : pm2 logs bluedm
=====================================================
Nếu https chưa vào được: kiểm tra tên miền đã trỏ (bản ghi A) về IP VPS này chưa,
rồi chạy: systemctl restart caddy
EOF
