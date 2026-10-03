const { db } = require('../db');
const auth = require('../auth');
const sms = require('../lib/sms');

async function login(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedForMs(ip);
  if (wait > 0) return { status: 429, body: { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` } };
  const body = await auth.readJsonBody(req);
  const row = db.prepare('SELECT id, password_salt, password_hash FROM admins WHERE email = ?').get(String(body.email || '').trim().toLowerCase());
  if (!row || !auth.checkPassword(body.password, row.password_salt, row.password_hash)) {
    auth.registerFail(ip);
    return { status: 401, body: { error: 'E-posta veya şifre hatalı.' } };
  }
  auth.registerSuccess(ip);
  const token = auth.newSession('admin', row.id);
  auth.setSessionCookie(req, res, token, 'admin');
  return { status: 200, body: { ok: true } };
}
async function logout(req, res) {
  auth.destroySession(req);
  auth.clearSessionCookie(req, res);
  return { status: 200, body: { ok: true } };
}

/* "Sifremi unuttum" - dealer-auth.js'teki AYNI dogrulanmis desen (13.09.2026,
   admin sifresini unuttugunda kurtarma yolu olmadigi fark edilince eklendi).
   Tek admin oldugu icin e-posta ile bulunur; kayitli telefonuna+onayli SMS
   basligina yeni, rastgele bir sifre gonderilir. Guvenlik: hangi e-postanin
   sistemde olup olmadigini disariya sizdirmamak icin HER DURUMDA ayni genel
   mesaj donulur; IP bazli deneme kilidi SMS bombalamayi engeller. */
async function forgotPassword(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedForMs(ip);
  if (wait > 0) return { status: 429, body: { error: `Çok fazla deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` } };
  const body = await auth.readJsonBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const generic = { status: 200, body: { ok: true, message: 'Bu e-posta sistemde kayıtlıysa ve bir telefon numarası tanımlıysa, o numaraya yeni şifre içeren bir SMS gönderildi.' } };
  if (!email) return generic;
  auth.registerFail(ip); // basarili da olsa deneme sayilir - SMS bombalamayi sinirlar
  const admin = db.prepare('SELECT id, phone, sms_header FROM admins WHERE email = ?').get(email);
  if (!admin || !admin.phone || !admin.sms_header) return generic;
  const newPassword = auth.randomNumericPassword();
  const cred = auth.makeCredential(newPassword);
  db.prepare('UPDATE admins SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, admin.id);
  const message = `AlfaPOS Bulut Admin Paneli sifre sifirlama:\nKullanici adi: ${email}\nYeni sifre: ${newPassword}`;
  await sms.sendSms(admin.phone, message, admin.sms_header).catch(() => {});
  return generic;
}

module.exports = [
  { method: 'POST', path: '/api/admin/login', handler: login },
  { method: 'POST', path: '/api/admin/logout', handler: logout },
  { method: 'POST', path: '/api/admin/forgot-password', handler: forgotPassword }
];
