/* [SUNUCU TARAFI - bu dosya BULUTTA (bu VPS'te, EnsariPosCloud servisinde)
   calisir, restoran bilgisayarina KURULMAZ. Tunelin KARSI/YEREL tarafi
   C:\gelismis-kurye-sistemi\tunnel.js'dir - o, restoranin KENDI bilgisayarina
   kurulup BURAYA disari dogru baglanir.]

   Gelismis Kurye Sistemi icin GENEL AMACLI ters HTTP tuneli. agent-ws.js (Kurye Bulut)
   ile ayni baglanti-yonetimi iskeleti (Map, reconnect, aktivasyon anahtariyla kimlik
   dogrulama) ama TAMAMEN FARKLI bir mesaj protokolu: Kurye Bulut sadece "sync" (veri
   aynalama) + "delivered" (tek action turu) biliyor, Gelismis Kurye Sistemi ise
   claim/deliver/payment-types/location/report/my-deliveries gibi 10+ ucu olan TAM bir
   web uygulamasi - o yuzden burada TEK BIR sey yapiliyor: gelen HER HTTP istegini
   (method/path/header/govde) oldugu gibi tunelin icinden restoran bilgisayarindaki
   uygulamaya iletip cevabi aynen geri getirmek. Restoran tarafindaki kod (server.js)
   TEK SATIR degismeden calismaya devam eder - kendi PIN/oturum/lisans mantigi tunelin
   FARKINDA bile degil, sadece "bir istek geldi, cevap ver" gorur. */
const { WebSocketServer } = require('ws');
const { db } = require('../db');
const { licenseActive } = require('../lib/license');

const connections = new Map(); // customer_id -> ws
const pending = new Map(); // requestId -> { resolve, timer }
const REQUEST_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 25000;

function send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }

function markGkConnected(customerId) {
  db.prepare(`
    INSERT INTO gelismis_kurye_status (customer_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(customerId, Date.now());
}

/* WS baglantisi temiz bir 'close' olayi olmadan kopabilir (ag kesintisi, uyku modu,
   NAT/firewall'un uzun sureli bosta baglantiyi sessizce dusurmesi) - bu durumda
   `connections` Map'inde OLU bir ws nesnesi kalir, `isConnected()` hala true doner
   ama sendTunneledRequest() cevapsiz kalip 15sn sonra TIMEOUT'a duser (canli ortamda
   "odeme alamiyor, istek basarisiz" seklinde gozlemlendi - 13.09.2026). Standart
   `ws` kutuphanesi ping/pong deseniyle her HEARTBEAT_INTERVAL_MS'de bir kontrol
   edilip, cevap vermeyen baglantilar terminate() ile hemen temizlenir. */
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
    if (u.pathname !== '/gk-tunnel') return; // baska bir modul (agent-ws/patron-ws) sahiplenebilir
    const gkKey = u.searchParams.get('key') || '';
    const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_gelismis_kurye FROM customers WHERE gk_activation_key = ? AND deleted_at IS NULL').get(gkKey);
    if (!customer || !licenseActive(customer) || !customer.has_gelismis_kurye) {
      console.log(new Date().toISOString(), 'gk-tunnel reddedildi, anahtar:', gkKey, 'sebep:', !customer ? 'anahtar bulunamadi' : (!licenseActive(customer) ? 'lisans aktif degil/suresi dolmus' : 'Gelismis Kurye urunu yok'));
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const customerId = customer.id;
      connections.set(customerId, ws);
      markGkConnected(customerId);
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
            markGkConnected(customerId); // tunel acikken de "bagli" gorunsun diye
          }
        } catch (error) {
          console.log(new Date().toISOString(), 'gk-tunnel mesaji islenemedi (musteri', customerId, '):', error.message);
        }
      });
      const onGone = () => { if (connections.get(customerId) === ws) connections.delete(customerId); };
      ws.on('close', onGone);
      ws.on('error', onGone);
    });
  });
}

/* Bir tarayici istegini (method/path/headers/govde) tunelin icinden restoran
   bilgisayarina iletir, cevabi bekler. Baglanti yoksa ya da zaman asimina ugrarsa
   reddeder - cagiran taraf (routes/gk-web.js) buna gore "baglanti yok" sayfasi gosterir. */
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
