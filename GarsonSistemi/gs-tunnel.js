/* [SUNUCU TARAFI - bu dosya BULUTTA (bu VPS'te, EnsariPosCloud servisinde)
   calisir, restoran bilgisayarina KURULMAZ. Tunelin KARSI/YEREL tarafi
   C:\garson-sistemi\tunnel.js'dir - o, restoranin KENDI bilgisayarina kurulup
   BURAYA disari dogru baglanir.]

   Garson Sistemi icin GENEL AMACLI ters HTTP tuneli. C:\toplu\gk-tunnel.js ile AYNI
   baglanti-yonetimi iskeleti (Map, reconnect, aktivasyon anahtariyla kimlik
   dogrulama, ping/pong heartbeat) - bagimsiz kopya, urunler kod duzeyinde birbirine
   bagli degil.

   TEK FARK (gk-tunnel.js'e gore): baglantinin gozlemlenen GENEL IP'sini de saklar -
   "sadece isletme WiFi'sinde calissin" kisitlamasi (routes/gs-web.js) bunu, garsonun
   telefonunun HER istekte gozlemlenen genel IP'siyle karsilastirir. Ayni router/NAT
   arkasindaysa ikisi de ayni genel IP'yi paylasir. */
const { WebSocketServer } = require('ws');
const { db } = require('../db');
const { licenseActive } = require('../lib/license');

const connections = new Map(); // customer_id -> { ws, publicIp }
const pending = new Map(); // requestId -> { resolve, timer }
const REQUEST_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 25000;

function send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }

function markConnected(customerId) {
  db.prepare(`
    INSERT INTO garson_status (customer_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(customerId, Date.now());
}

/* Cloudflare arkasinda gercek istemci IP'si CF-Connecting-IP basliginda gelir;
   olmazsa (dogrudan erisim/test) X-Forwarded-For'un ilk halkasi, o da yoksa
   soketin kendi adresi kullanilir. */
function realIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || '';
}

function startHeartbeat() {
  setInterval(() => {
    for (const [customerId, entry] of connections) {
      if (entry.ws.isAlive === false) { entry.ws.terminate(); connections.delete(customerId); continue; }
      entry.ws.isAlive = false;
      try { entry.ws.ping(); } catch { entry.ws.terminate(); connections.delete(customerId); }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });
  startHeartbeat();
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://internal');
    if (u.pathname !== '/gs-tunnel') return; // baska bir modul sahiplenebilir
    const gsKey = u.searchParams.get('key') || '';
    const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_garson FROM customers WHERE gs_activation_key = ? AND deleted_at IS NULL').get(gsKey);
    if (!customer || !licenseActive(customer) || !customer.has_garson) {
      console.log(new Date().toISOString(), 'gs-tunnel reddedildi, anahtar:', gsKey, 'sebep:', !customer ? 'anahtar bulunamadi' : (!licenseActive(customer) ? 'lisans aktif degil/suresi dolmus' : 'Garson Sistemi urunu yok'));
      socket.destroy();
      return;
    }
    const tunnelIp = realIp(req);

    wss.handleUpgrade(req, socket, head, ws => {
      const customerId = customer.id;
      connections.set(customerId, { ws, publicIp: tunnelIp });
      markConnected(customerId);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

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
            markConnected(customerId);
          }
        } catch (error) {
          console.log(new Date().toISOString(), 'gs-tunnel mesaji islenemedi (musteri', customerId, '):', error.message);
        }
      });
      const onGone = () => { if (connections.get(customerId) && connections.get(customerId).ws === ws) connections.delete(customerId); };
      ws.on('close', onGone);
      ws.on('error', onGone);
    });
  });
}

function sendTunneledRequest(customerId, request) {
  const entry = connections.get(customerId);
  if (!entry) return Promise.reject(new Error('NOT_CONNECTED'));
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('TIMEOUT')); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    send(entry.ws, { type: 'request', id, ...request });
  });
}

function isConnected(customerId) { return connections.has(customerId); }
function getTunnelPublicIp(customerId) { const e = connections.get(customerId); return e ? e.publicIp : null; }

module.exports = { attach, sendTunneledRequest, isConnected, getTunnelPublicIp, realIp };
