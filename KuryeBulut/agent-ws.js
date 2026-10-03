/* Restoran bilgisayarindaki ajanin (C:\kurye-bulut-ajan) buluta baglandigi
   WebSocket ucu. Musteri/bayi/admin/kurye TARAYICI oturumlariyla ilgisi
   yok - bu tamamen ajan<->bulut hattidir. Mevcut /api/agent/push (satis
   ozeti, C:\ensari kullaniyor) HTTP ucuna hic dokunulmuyor, bu ayri bir yol. */
const { WebSocketServer } = require('ws');
const { db } = require('../db');
const { licenseActive } = require('../lib/license');

const connections = new Map(); // customer_id -> ws

function send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }

function markConnected(customerId, connected) {
  db.prepare(`
    INSERT INTO agent_status (customer_id, connected, last_seen_at) VALUES (?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET connected = excluded.connected, last_seen_at = excluded.last_seen_at
  `).run(customerId, connected ? 1 : 0, Date.now());
}

/* Kurye/PIN listesi UPSERT edilir (telefon hic dokunulmaz - o sadece
   /api/customer/couriers/:name/phone ile admin tarafindan yazilir, ayni
   C:\kurye takip'teki courier_phones ayrimi). Siparisler ise her sync'te
   tamamen yenilenir - "su an aktif olan budur" prensibi. */
/* courier_orders ile AYNI "replace-all" mantigi, ama TAMAMEN BAGIMSIZ bir
   tabloya yazar - burasi patlarsa (beklenmeyen veri sekli vb.) kurye
   PIN'leri/siparisleri asla etkilenmez, cunku o yazma islemi bu
   fonksiyondan once ve ayri try/catch ile korunur (bkz. asagida cagiran yer). */
/* BEGIN/COMMIT ile sarilir: DELETE ile yeniden INSERT arasinda kisa bir an
   icin tablo BOS gorunebiliyordu - kurye tam o anda /api/courier/orders
   cektiginde siparisleri gecici olarak sifir goruyordu (canli testte
   yakalandi). Tek bir islem (transaction) icinde yapinca ARA DURUM disariya
   asla sizmiyor - okuyan taraf ya eski TAM veriyi ya yeni TAM veriyi gorur. */
function replaceUnassigned(customerId, unassigned) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO unassigned_orders (customer_id, ticket_id, number, total, customer_name, address, phone, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM unassigned_orders WHERE customer_id = ?').run(customerId);
    for (const o of unassigned || []) {
      insert.run(customerId, String(o.id), String(o.number || ''), Number(o.total) || 0,
        String(o.customerName || ''), String(o.address || ''), String(o.phone || ''), now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function replaceCourierData(customerId, couriers, orders) {
  const upsertPin = db.prepare(`
    INSERT INTO courier_pins (customer_id, courier_name, pin, phone) VALUES (?, ?, ?, NULL)
    ON CONFLICT(customer_id, courier_name) DO UPDATE SET pin = excluded.pin
  `);
  // INSERT OR REPLACE: ajan tarafindan gonderilen bir sync payload'inda ayni
  // ticket_id iki kez gelirse (SambaPOS tarafindaki bir JOIN/durum gecmisi
  // ceşitlenmesinden kaynaklanabilir) duz INSERT, (customer_id, ticket_id)
  // PRIMARY KEY'ine carpip TUM sunucuyu (tum musterileri) coken bir istisna
  // firlatiyordu - REPLACE ile son gelen satir gecerli sayilip sessizce devam eder.
  const insertOrder = db.prepare(`
    INSERT OR REPLACE INTO courier_orders (customer_id, ticket_id, courier_name, number, total, package_status, customer_name, address, phone, content_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const c of couriers) { if (c && c.name && c.pin) upsertPin.run(customerId, String(c.name), String(c.pin)); }
    db.prepare('DELETE FROM courier_orders WHERE customer_id = ?').run(customerId);
    for (const o of orders || []) {
      insertOrder.run(customerId, String(o.id), String(o.courierName || ''), String(o.number || ''), Number(o.total) || 0,
        String(o.packageStatus || ''), String(o.customerName || ''), String(o.address || ''), String(o.phone || ''),
        JSON.stringify(o.content || []), now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://internal');
    // socket.destroy() BURADA YAPILMAZ: server.js artik birden fazla modul
    // (patron-ws.js) ayni http.Server'in 'upgrade' event'ini dinliyor - path
    // kendisine ait degilse sadece sessizce cekilir, digeri islesin diye.
    // Hicbir modul sahiplenmezse server.js'deki genel yedek destroy eder.
    if (u.pathname !== '/agent-ws') return;
    const activationKey = u.searchParams.get('activationKey') || '';
    const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_kurye FROM customers WHERE activation_key = ? AND deleted_at IS NULL').get(activationKey);
    if (!customer || !licenseActive(customer) || !customer.has_kurye) {
      console.log(new Date().toISOString(), 'agent-ws reddedildi, anahtar:', activationKey, 'sebep:', !customer ? 'anahtar bulunamadi' : (!licenseActive(customer) ? 'lisans aktif degil/suresi dolmus' : 'kurye urunu yok'));
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const customerId = customer.id;
      connections.set(customerId, ws);
      markConnected(customerId, true);

      // Baglanti kurulur kurulmaz, bu ajan cevrimdisiyken birikmis komutlari gonder.
      const pending = db.prepare('SELECT id, action, ticket_id FROM pending_actions WHERE customer_id = ? AND done_at IS NULL').all(customerId);
      for (const p of pending) send(ws, { type: 'action', id: p.id, action: p.action, ticketId: p.ticket_id });

      ws.on('message', raw => {
        // TEK bir ajanin gonderdigi beklenmedik/bozuk bir veri, tum bulut
        // sunucusunu (yani TUM musterileri) asla coktermemeli - bu yuzden
        // burasi tamamen izole edilir; sadece o mesaj yoksayilip loglanir.
        try {
          let msg; try { msg = JSON.parse(raw); } catch { return; }
          if (msg.type === 'sync') {
            replaceCourierData(customerId, msg.couriers || [], msg.orders || []);
            // Kurye siparisleri basariyla yazildiktan SONRA, ayri/izole bir
            // adim olarak atanmamis paketler de yazilir - burasi patlarsa
            // yukaridaki satir zaten commit edilmis olur, etkilenmez.
            try { replaceUnassigned(customerId, msg.unassigned || []); } catch (error) { console.log(new Date().toISOString(), 'atanmamis paketler yazilamadi (yoksayildi, musteri', customerId, '):', error.message); }
          } else if (msg.type === 'ack') {
            db.prepare('UPDATE pending_actions SET done_at = ? WHERE id = ? AND customer_id = ?').run(Date.now(), msg.id, customerId);
          } else if (msg.type === 'event') {
            db.prepare('INSERT INTO delivery_events (customer_id, ticket_id, courier_name, event, detail, amount, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(customerId, msg.ticketId ?? null, msg.courierName ?? null, msg.event, msg.detail ?? null, msg.amount ?? null, Date.now());
          }
        } catch (error) {
          console.log(new Date().toISOString(), 'agent-ws mesaji islenemedi (musteri', customerId, '):', error.message);
        }
      });
      const onGone = () => { if (connections.get(customerId) === ws) connections.delete(customerId); markConnected(customerId, false); };
      ws.on('close', onGone);
      ws.on('error', onGone);
    });
  });
}

/* Kurye tarayicidan "Teslim Edildi" dedi - ajana komut yollar (bagliysa
   hemen, degilse ajan bir sonraki baglantisinda ceker). */
function sendAction(customerId, action, ticketId) {
  const result = db.prepare('INSERT INTO pending_actions (customer_id, action, ticket_id, created_at) VALUES (?, ?, ?, ?)')
    .run(customerId, action, ticketId, Date.now());
  const id = Number(result.lastInsertRowid);
  const ws = connections.get(customerId);
  if (ws) send(ws, { type: 'action', id, action, ticketId });
  return id;
}

function isConnected(customerId) { return connections.has(customerId); }

module.exports = { attach, sendAction, isConnected };
