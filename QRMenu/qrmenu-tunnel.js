/* [SUNUCU TARAFI - bu dosya BULUTTA (bu VPS'te, EnsariPosCloud servisinde)
   calisir, restoran bilgisayarina KURULMAZ. Tunelin KARSI/YEREL tarafi
   C:\alfapos-qrmenu-yerel\tunnel.js'dir - o, restoranin KENDI bilgisayarina
   kurulup BURAYA disari dogru baglanir.]

   QR Menü icin GENEL AMACLI ters HTTP tuneli - C:\toplu\gk-tunnel.js (Gelismis
   Kurye Sistemi) ile BIREBIR AYNI iskelet (19.09.2026, kullanici karari: "QR
   Menü artik C:\SambaPOS Menu motoruyla, bulutta sabit adresten tunel
   uzerinden calisacak, eski C:\qrmenu tamamen kalksin"). Diger urunlerin
   (gelismis_kurye, ultra_paketci, garson) lisansindan/tunelinden TAMAMEN
   BAGIMSIZ. QR Menü paylasilan (AYRI DEGIL) "activation_key" + "has_qrmenu"
   kullanir - Kurye/Patron ile AYNI anahtar, musteri ek bir anahtar EZBERLEMEZ. */
const { WebSocketServer } = require('ws');
const { db } = require('../db');
const { licenseActive } = require('../lib/license');
const qrCache = require('./qrmenu-cache');

const connections = new Map(); // customer_id -> ws
const pending = new Map(); // requestId -> { resolve, timer }
const REQUEST_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 25000;

function send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }

function markQrmenuConnected(customerId) {
  db.prepare(`
    INSERT INTO qrmenu_status (customer_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(customerId, Date.now());
}

/* gk-tunnel.js'teki AYNI gerekce: WS baglantisi temiz bir 'close' olmadan
   kopabilir, ping/pong ile olu baglanti duzenli temizlenir. FARK (19.09.2026,
   canli tespit - QR Menü tuneli birkac dakikada bir gereksiz yere kopup
   yeniden baglaniyordu): TEK bir kacan pong'da hemen sonlandirmak yerine
   ARKA ARKAYA 2 kacan pong'dan sonra sonlandirilir - Cloudflare gibi ara
   katmanlarin TEK bir dusuk seviye ping/pong kontrol cercevesini zaman zaman
   yutmasi, hala saglikli olan bir baglantinin gereksiz yere koparilmasina
   (ve musteriye "Bağlantı yok" gorunmesine) yol aciyordu. */
function startHeartbeat() {
  setInterval(() => {
    for (const [customerId, ws] of connections) {
      if (ws.missedPongs >= 2) { ws.terminate(); connections.delete(customerId); continue; }
      if (ws.isAlive === false) ws.missedPongs = (ws.missedPongs || 0) + 1;
      ws.isAlive = false;
      try { ws.ping(); } catch { ws.terminate(); connections.delete(customerId); }
      qrCache.prewarm(customerId, sendTunneledRequest, false).catch(() => {}); // 30 dk'da bir kendisi tazeler
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/* Musterinin QR Menü herkese-acik adresi (menu.ornek-alanadi.com/<slug>) icin
   kalici bir slug - business_name'den turetilir, ilk tunel baglantisinda
   BIR KEZ uretilip customers.qrmenu_slug'a yazilir (C:\qrmenu\lib\restaurants.js
   slugify()/uniqueSuffix() ile AYNI mantik, o dosyadan tasindi). */
const TR_MAP = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };
function slugify(value) {
  const text = String(value || '').replace(/[çÇğĞıİöÖşŞüÜ]/g, c => TR_MAP[c] || c);
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'restoran';
}
function randomSuffix() {
  let out = '';
  for (let i = 0; i < 6; i++) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}
function ensureSlug(customer) {
  if (customer.qrmenu_slug) return customer.qrmenu_slug;
  const base = slugify(customer.business_name);
  const exists = db.prepare('SELECT 1 FROM customers WHERE qrmenu_slug = ?');
  let slug = `${base}-${randomSuffix()}`;
  for (let i = 0; i < 20 && exists.get(slug); i++) slug = `${base}-${randomSuffix()}`;
  db.prepare('UPDATE customers SET qrmenu_slug = ? WHERE id = ?').run(slug, customer.id);
  return slug;
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });
  startHeartbeat();
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://internal');
    if (u.pathname !== '/qrmenu-tunnel') return; // baska bir modul sahiplenebilir
    const key = u.searchParams.get('key') || '';
    const customer = db.prepare('SELECT id, business_name, qrmenu_slug, subscription_status, license_expires_at, has_qrmenu FROM customers WHERE activation_key = ? AND deleted_at IS NULL').get(key);
    if (!customer || !licenseActive(customer) || !customer.has_qrmenu) {
      console.log(new Date().toISOString(), 'qrmenu-tunnel reddedildi, anahtar:', key, 'sebep:', !customer ? 'anahtar bulunamadi' : (!licenseActive(customer) ? 'lisans aktif degil/suresi dolmus' : 'QR Menü urunu yok'));
      socket.destroy();
      return;
    }
    const slug = ensureSlug(customer);

    wss.handleUpgrade(req, socket, head, ws => {
      const customerId = customer.id;
      connections.set(customerId, ws);
      markQrmenuConnected(customerId);
      ws.isAlive = true;
      ws.missedPongs = 0;
      ws.on('pong', () => { ws.isAlive = true; ws.missedPongs = 0; });

      /* Yerel tarafin KENDI musteri-menu adresini (slug) bilmesi lazim - orn.
         masa QR kodlarini uretirken "hangi restoranin linki oldugu" bilinsin
         diye (20.09.2026, kullanici bulgusu: "satacagiz, hangi restoranin
         oldugu belli olmasi lazim" - onceden tableOrderUrl() sadece
         location.origin kullanip musteri kimligini TAMAMEN atliyordu).
         Baglanti kurulur kurulmaz slug'i tek seferlik bir mesajla bildiriyoruz. */
      send(ws, { type: 'hello', slug, menuBaseUrl: `https://menu.ornek-alanadi.com/${slug}` });
      /* 02.10.2026: bilgisayar kapaliyken de menu acilsin diye buluttaki kopyayi tazele (qrmenu-cache.js) */
      setTimeout(() => { if (connections.get(customerId) === ws) qrCache.prewarm(customerId, sendTunneledRequest, true).catch(() => {}); }, 8000);

      ws.on('message', raw => {
        try {
          let msg; try { msg = JSON.parse(raw); } catch { return; }
          if (msg.type === 'response') {
            const entry = pending.get(msg.id);
            if (!entry) return;
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            entry.resolve(msg);
          } else if (msg.type === 'ping') {
            markQrmenuConnected(customerId);
          }
        } catch (error) {
          console.log(new Date().toISOString(), 'qrmenu-tunnel mesaji islenemedi (musteri', customerId, '):', error.message);
        }
      });
      const onGone = () => { if (connections.get(customerId) === ws) connections.delete(customerId); };
      ws.on('close', onGone);
      ws.on('error', onGone);
    });
  });
}

function sendTunneledRequest(customerId, request) {
  const ws = connections.get(customerId);
  if (!ws) return Promise.reject(new Error('NOT_CONNECTED'));
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('TIMEOUT')); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    send(ws, { type: 'request', id, ...request });
  });
}

function isConnected(customerId) { return connections.has(customerId); }

function findCustomerBySlug(slug) {
  return db.prepare('SELECT id, subscription_status, license_expires_at, has_qrmenu FROM customers WHERE qrmenu_slug = ? AND deleted_at IS NULL').get(slug);
}
function findCustomerByIdentifier(identifier) {
  const value = String(identifier || '').trim().toLowerCase();
  return db.prepare(`
    SELECT id, subscription_status, license_expires_at, has_qrmenu
    FROM customers
    WHERE deleted_at IS NULL AND has_qrmenu = 1
      AND (LOWER(activation_key) = ? OR LOWER(business_name) = ? OR LOWER(email) = ? OR LOWER(phone) = ?)
  `).get(value, value, value, value);
}

module.exports = { attach, sendTunneledRequest, isConnected, findCustomerBySlug, findCustomerByIdentifier, licenseActive };
