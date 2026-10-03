const { db } = require('../db');
const auth = require('../auth');
const { licenseActive } = require('../lib/license');

/* Kurye girisi: isletme adi (veya aktivasyon anahtari) + PIN. PIN, ajanin
   sambapos.js'ten okuyup push'ladigi courier_pins tablosuna karsi
   dogrulanir - SambaPOS'a burada hic dogrudan erisilmiyor. */
async function login(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedForMs(ip);
  if (wait > 0) return { status: 429, body: { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` } };
  const body = await auth.readJsonBody(req);
  const business = String(body.business || '').trim();
  const pin = String(body.pin || '').trim();
  if (!business || !/^\d+$/.test(pin)) { auth.registerFail(ip); return { status: 401, body: { error: 'İşletme adı veya PIN hatalı.' } }; }
  const customer = db.prepare('SELECT id, subscription_status, license_expires_at FROM customers WHERE deleted_at IS NULL AND (business_name = ? OR activation_key = ? OR email = ? OR phone = ?)').get(business, business, business.toLowerCase(), business);
  if (!customer || !licenseActive(customer)) { auth.registerFail(ip); return { status: 401, body: { error: 'İşletme adı veya PIN hatalı.' } }; }
  const row = db.prepare('SELECT courier_name FROM courier_pins WHERE customer_id = ? AND pin = ?').get(customer.id, pin);
  if (!row) { auth.registerFail(ip); return { status: 401, body: { error: 'İşletme adı veya PIN hatalı.' } }; }
  auth.registerSuccess(ip);
  const token = auth.newSession('courier', customer.id, { courierName: row.courier_name });
  auth.setSessionCookie(req, res, token, 'courier');
  return { status: 200, body: { ok: true, courierName: row.courier_name } };
}
async function logout(req, res) {
  auth.destroySession(req);
  auth.clearSessionCookie(req, res);
  return { status: 200, body: { ok: true } };
}

module.exports = [
  { method: 'POST', path: '/api/courier/login', handler: login },
  { method: 'POST', path: '/api/courier/logout', handler: logout }
];
