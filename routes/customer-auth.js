const { db } = require('../db');
const auth = require('../auth');
const { licenseActive } = require('../lib/license');

async function login(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedForMs(ip);
  if (wait > 0) return { status: 429, body: { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` } };
  const body = await auth.readJsonBody(req);
  const username = String(body.username || '').trim();
  /* ONEMLI: eskiden SADECE email alani kucuk harfe cevriliyordu (business_name/
     activation_key/phone HASSAS karsilastiriliyordu) - musteri isletme adini
     (orn. "Öz Urfa..." yerine "öz urfa...") farkli buyuk/kucuk harfle yazinca,
     sifre dogru olsa bile "kullanici adi veya sifre hatali" hatasi aliyordu
     (13.09.2026, canli sikayet: "sifre veriyorum ama musteri giremiyor").
     Artik TUM alanlar HER IKI tarafta da kucuk harfe cevrilerek karsilastirilir. */
  const row = db.prepare('SELECT id, password_salt, password_hash, subscription_status, license_expires_at FROM customers WHERE deleted_at IS NULL AND (LOWER(business_name) = LOWER(?) OR LOWER(activation_key) = LOWER(?) OR LOWER(email) = LOWER(?) OR LOWER(phone) = LOWER(?))')
    .get(username, username, username, username);
  if (!row || !auth.checkPassword(body.password, row.password_salt, row.password_hash)) {
    auth.registerFail(ip);
    return { status: 401, body: { error: 'Kullanıcı adı veya şifre hatalı.' } };
  }
  if (!licenseActive(row)) {
    return { status: 403, body: { error: 'Hesabınız aktif değil veya lisans süreniz dolmuş. Bayinizle iletişime geçin.' } };
  }
  auth.registerSuccess(ip);
  db.prepare('UPDATE customers SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  const token = auth.newSession('customer', row.id);
  auth.setSessionCookie(req, res, token, 'customer');
  return { status: 200, body: { ok: true } };
}
async function logout(req, res) {
  auth.destroySession(req);
  auth.clearSessionCookie(req, res);
  return { status: 200, body: { ok: true } };
}

module.exports = [
  { method: 'POST', path: '/api/customer/login', handler: login },
  { method: 'POST', path: '/api/customer/logout', handler: logout }
];
