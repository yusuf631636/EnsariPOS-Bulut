/* [SUNUCU TARAFI - bu dosya BULUTTA (bu VPS'te, EnsariPosCloud servisinde)
   calisir, restoran bilgisayarina KURULMAZ. Tunelin KARSI/YEREL tarafi
   C:\ultra-paketci\tunnel.js'dir - o, restoranin KENDI bilgisayarina
   kurulup BURAYA disari dogru baglanir.]

   Ultra Paketci icin GENEL AMACLI ters HTTP tuneli. gk-tunnel.js ile AYNI
   baglanti-yonetimi iskeleti (Map, reconnect, aktivasyon anahtariyla kimlik
   dogrulama) - KASITLI OLARAK bagimsiz bir kopya, gk-tunnel.js'e HICBIR SEKILDE
   dokunmadan yanina eklendi (15.09.2026).

   NEDEN AYRI: Ultra Paketci, Gelismis Kurye Sistemi'nin genisletilmis surumu -
   ayni restoranda ikisi yan yana kurulabilsin diye TASARLANDI. Ama ilk surumde
   ikisi AYNI gk_activation_key'i VE AYNI tunel yolunu (/gk-tunnel) kullaniyordu -
   gk-tunnel.js'in `connections` Map'i musteri basina SADECE TEK baglanti
   tuttugundan, ikisi de baglanmaya calisinca SON baglanan digerinin yerini
   ALIYORDU ("ultra.ornek-alanadi.com'a girince Gelismis Kurye Sistemi'nin verisi
   geliyor, PIN hatasi aliyor" - canli tespit edildi, 15.09.2026). Cozum: Ultra
   Paketci artik KENDI AYRI aktivasyon anahtarini (ultra_activation_key) ve KENDI
   AYRI tunel yolunu (/ultra-tunnel, bu dosya) kullaniyor - iki urun artik
   YAPISAL olarak asla ayni "musteri baglanti yuvasini" paylasamaz. */
const { WebSocketServer } = require('ws');
const { db } = require('../db');
const { licenseActive } = require('../lib/license');

const connections = new Map(); // customer_id -> ws
const pending = new Map(); // requestId -> { resolve, timer }
const REQUEST_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 25000;

function send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }

function markUltraConnected(customerId) {
  db.prepare(`
    INSERT INTO ultra_paketci_status (customer_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(customerId, Date.now());
}

function startHeartbeat() {
  setInterval(() => {
    for (const [customerId, ws] of connections) {
      if (ws.isAlive === false) { ws.terminate(); connections.delete(customerId); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { ws.terminate(); connections.delete(customerId); }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });
  startHeartbeat();
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://internal');
    if (u.pathname !== '/ultra-tunnel') return; // baska bir modul (gk-tunnel/agent-ws/patron-ws) sahiplenebilir
    const ultraKey = u.searchParams.get('key') || '';
    const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_ultra_paketci FROM customers WHERE ultra_activation_key = ? AND deleted_at IS NULL').get(ultraKey);
    if (!customer || !licenseActive(customer) || !customer.has_ultra_paketci) {
      console.log(new Date().toISOString(), 'ultra-tunnel reddedildi, anahtar:', ultraKey, 'sebep:', !customer ? 'anahtar bulunamadi' : (!licenseActive(customer) ? 'lisans aktif degil/suresi dolmus' : 'Ultra Paketci urunu yok'));
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const customerId = customer.id;
      connections.set(customerId, ws);
      markUltraConnected(customerId);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', raw => {
        try {
          let msg; try { msg = JSON.parse(raw); } catch { return; }
          if (msg.type === 'response') {
            const entry = pending.get(msg.id);
            if (!entry) return; // zaman asimina ugramis/eslesmemis bir cevap - yoksay
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            entry.resolve(msg);
          } else if (msg.type === 'ping') {
            markUltraConnected(customerId); // tunel acikken de "bagli" gorunsun diye
          }
        } catch (error) {
          console.log(new Date().toISOString(), 'ultra-tunnel mesaji islenemedi (musteri', customerId, '):', error.message);
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

module.exports = { attach, sendTunneledRequest, isConnected };
