const { db } = require('../db');
const auth = require('../auth');
const agentWs = require('./agent-ws');

function myOrders(req, res, session) {
  if (!auth.requireRole('courier')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT ticket_id AS id, number, total, package_status AS packageStatus,
           customer_name AS customerName, address, phone
    FROM courier_orders WHERE customer_id = ? AND courier_name = ? ORDER BY ticket_id DESC
  `).all(session.id, session.courierName);
  return { status: 200, body: { orders: rows, courierName: session.courierName } };
}

function orderContent(req, res, session, query) {
  if (!auth.requireRole('courier')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const ticketId = query.get('id');
  const row = db.prepare('SELECT content_json, courier_name FROM courier_orders WHERE customer_id = ? AND ticket_id = ?').get(session.id, ticketId);
  if (!row || row.courier_name !== session.courierName) return { status: 403, body: { error: 'Bu siparişe erişiminiz yok.' } };
  let items = [];
  try { items = JSON.parse(row.content_json || '[]'); } catch { /* bos birak */ }
  return { status: 200, body: { items } };
}

/* Kurye "Teslim Edildi" dedi - ajana WebSocket ile komut yollanir (bagliysa
   hemen isler, degilse kuyruga girer); gercek SQL yazimi ajanda olur, o
   yuzden burada iyimser bir "ok" donuyoruz. */
async function deliver(req, res, session, query) {
  if (!auth.requireRole('courier')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const ticketId = query.get('id');
  const row = db.prepare('SELECT courier_name FROM courier_orders WHERE customer_id = ? AND ticket_id = ?').get(session.id, ticketId);
  if (!row || row.courier_name !== session.courierName) return { status: 403, body: { error: 'Bu siparişe erişiminiz yok.' } };
  agentWs.sendAction(session.id, 'delivered', ticketId);
  return { status: 200, body: { ok: true } };
}

/* Kurye telefonundaki konumu ~15 saniyede bir buraya push eder (bkz. courier
   app.js startLocationSharing) - restoran sahibi musteri panelindeki haritada
   gorur. Ayni musterinin diger kuryeleri veya baska musteriler bu veriyi hic
   goremez, sorgu her zaman customer_id ile sinirli. */
async function setLocation(req, res, session) {
  if (!auth.requireRole('courier')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const lat = Number(body.lat), lng = Number(body.lng), accuracy = Number(body.accuracy) || null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 400, body: { error: 'Geçersiz konum.' } };
  db.prepare(`
    INSERT INTO courier_locations (customer_id, courier_name, lat, lng, accuracy, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(customer_id, courier_name) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, accuracy=excluded.accuracy, updated_at=excluded.updated_at
  `).run(session.id, session.courierName, lat, lng, accuracy, Date.now());
  return { status: 200, body: { ok: true } };
}

module.exports = [
  { method: 'GET', path: '/api/courier/orders', handler: myOrders },
  { method: 'GET', path: '/api/courier/order-content', handler: orderContent },
  { method: 'POST', path: '/api/courier/deliver', handler: deliver },
  { method: 'POST', path: '/api/courier/location', handler: setLocation }
];
