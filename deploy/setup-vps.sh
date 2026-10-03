#!/bin/bash
# Ensari POS Bulut - taze bir Ubuntu VPS'te calistirilir (22.04/24.04).
# Bu script: Node.js LTS + uygulama servisini (systemd) + Caddy (otomatik HTTPS)
# kurar. SADECE BIR KEZ, sudo yetkisiyle calistirilir: sudo bash deploy/setup-vps.sh
set -e

APP_DIR="/opt/ensaripos-cloud"
DOMAIN="app.ensrapos.com"

if [ "$EUID" -ne 0 ]; then
  echo "Bu scripti sudo ile calistirin: sudo bash deploy/setup-vps.sh"
  exit 1
fi

echo "== 1/6: Node.js kuruluyor (v24 - burada test edilen surumle ayni) =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== 2/6: Uygulama kullanicisi olusturuluyor =="
if ! id -u ensaripos >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin ensaripos
fi

echo "== 3/6: Uygulama dosyalari kopyalaniyor =="
mkdir -p "$APP_DIR"
# Bu script'in bulundugu klasorun bir ust dizinini (proje kokunu) APP_DIR'e kopyalar.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
rsync -a --exclude 'node_modules' --exclude 'data' --exclude '.git' "$PROJECT_DIR"/ "$APP_DIR"/
chown -R ensaripos:ensaripos "$APP_DIR"

echo "== 4/6: npm bagimliliklari kuruluyor =="
cd "$APP_DIR"
sudo -u ensaripos npm install --omit=dev

echo "== 5/6: systemd servisi kuruluyor =="
cp "$APP_DIR/deploy/ensaripos-cloud.service" /etc/systemd/system/ensaripos-cloud.service
systemctl daemon-reload
systemctl enable ensaripos-cloud
systemctl restart ensaripos-cloud

echo "== 6/6: Caddy (otomatik HTTPS ters proxy) kuruluyor =="
if ! command -v caddy >/dev/null 2>&1; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.caddyserver.com/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.caddyserver.com/stable/deb.debian.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update
  apt install -y caddy
fi
cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl restart caddy

echo ""
echo "================================================"
echo " Kurulum tamamlandi."
echo " Servis durumu icin: systemctl status ensaripos-cloud"
echo " Loglar icin:        journalctl -u ensaripos-cloud -f"
echo ""
echo " ONEMLI - ilk admin hesabini olusturmayi UNUTMAYIN:"
echo "   cd $APP_DIR && sudo -u ensaripos node bootstrap-admin.js admin@ensrapos.com SIFRENIZ"
echo ""
echo " DNS: Cloudflare'de '$DOMAIN' icin bir A kaydi bu sunucunun IP'sine"
echo " isaret etmeli (turuncu bulut/proxy acik olabilir)."
echo "================================================"
