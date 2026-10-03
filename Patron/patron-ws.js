/* Patron Raporu'nun (C:\ensari) buluta baglandigi WebSocket ucu -
   agent-ws.js (kurye) ile AYNI desen, farkli amac: kurye siparis/konum
   senkronize eder, burasi SADECE asagi yonlu komut (fiyat guncelleme) tasir.
   Yukari yonlu veri (satis/acik masa/bildirim/menu) zaten HTTP ile
   /api/agent/push'a akiyor (routes/agent.js) - buna HIC dokunulmaz. */
const { WebSocketServer } = require('ws');
const { db } = require('../db');
const { licenseActive } = require('../lib/license');

const connections = new Map(); // customer_id -> ws

function send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://internal');
    if (u.pathname !== '/patron-ws') return; // agent-ws.js kendi pathini kontrol eder, cakisma yok
    const activationKey = u.searchParams.get('activationKey') || '';
    const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_patron FROM customers WHERE activation_key = ? AND deleted_at IS NULL').get(activationKey);
    if (!customer || !licenseActive(customer) || !customer.has_patron) {
      console.log(new Date().toISOString(), 'patron-ws reddedildi, anahtar:', activationKey, 'sebep:', !customer ? 'anahtar bulunamadi' : (!licenseActive(customer) ? 'lisans aktif degil/suresi dolmus' : 'Patron urunu yok'));
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const customerId = customer.id;
      connections.set(customerId, ws);

      // Baglanti kurulur kurulmaz, cevrimdisiyken birikmis komutlari gonder.
      const pending = db.prepare('SELECT id, action, payload_json FROM patron_pending_actions WHERE customer_id = ? AND done_at IS NULL').all(customerId);
      for (const p of pending) {
        let payload = {}; try { payload = JSON.parse(p.payload_json); } catch { /* bozuksa bos gec */ }
        send(ws, { type: 'action', id: p.id, action: p.action, ...payload });
      }

      ws.on('message', raw => {
        // TEK bir ajanin gonderdigi bozuk veri TUM sunucuyu (tum musterileri)
        // asla coktermemeli - agent-ws.js ile ayni izolasyon.
        try {
          let msg; try { msg = JSON.parse(raw); } catch { return; }
          if (msg.type === 'ack') {
            // Genellestirildi: eskiden sadece oldPrice/newPrice tasiniyordu - artik
            // hangi eylem olursa olsun (fiyat, adisyon detayi, vb.) msg'nin type/id
            // DISINDAKI TUM alanlari oldugu gibi saklanir. patronPriceStatus zaten
            // result_json'u JEnERIK okuyordu, burada degisiklik gerekmedi.
            const { type, id, ...rest } = msg;
            const result = { ok: msg.ok !== false, ...rest };
            db.prepare('UPDATE patron_pending_actions SET done_at = ?, result_json = ? WHERE id = ? AND customer_id = ?')
              .run(Date.now(), JSON.stringify(result), msg.id, customerId);
          }
        } catch (error) {
          console.log(new Date().toISOString(), 'patron-ws mesaji islenemedi (musteri', customerId, '):', error.message);
        }
      });
      const onGone = () => { if (connections.get(customerId) === ws) connections.delete(customerId); };
      ws.on('close', onGone);
      ws.on('error', onGone);
    });
  });
}

/* Musteri panelinden bir fiyat degisikligi kuyruga alinir - baglantiysa
   hemen, degilse ajan bir sonraki baglantisinda ceker (courier'daki
   sendAction() ile ayni fikir). */
function sendPatronAction(customerId, action, payload) {
  const result = db.prepare('INSERT INTO patron_pending_actions (customer_id, action, payload_json, created_at) VALUES (?, ?, ?, ?)')
    .run(customerId, action, JSON.stringify(payload || {}), Date.now());
  const id = Number(result.lastInsertRowid);
  const ws = connections.get(customerId);
  if (ws) { send(ws, { type: 'action', id, action, ...payload }); db.prepare('UPDATE patron_pending_actions SET sent_at = ? WHERE id = ?').run(Date.now(), id); }
  return id;
}

function isConnected(customerId) { return connections.has(customerId); }

module.exports = { attach, sendPatronAction, isConnected };
