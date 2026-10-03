const { db } = require('../db');
const auth = require('../auth');
const sms = require('../lib/sms');

async function login(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedForMs(ip);
  if (wait > 0) return { status: 429, body: { error: `Çok fazla hatalı deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` } };
  const body = await auth.readJsonBody(req);
  const row = db.prepare('SELECT id, password_salt, password_hash FROM dealers WHERE email = ?').get(String(body.email || '').trim().toLowerCase());
  if (!row || !auth.checkPassword(body.password, row.password_salt, row.password_hash)) {
    auth.registerFail(ip);
    return { status: 401, body: { error: 'E-posta veya şifre hatalı.' } };
  }
  auth.registerSuccess(ip);
  db.prepare('UPDATE dealers SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  const token = auth.newSession('dealer', row.id);
  auth.setSessionCookie(req, res, token, 'dealer');
  return { status: 200, body: { ok: true } };
}
async function logout(req, res) {
  auth.destroySession(req);
  auth.clearSessionCookie(req, res);
  return { status: 200, body: { ok: true } };
}

/* Giris yapmis bayi kendi sifresini degistirir - eski sifreyi dogru bilmek
   zorunda (oturum calinsa bile sifreyi elden ele degistirebilmeyi onler). */
async function changePassword(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (newPassword.length < 4) return { status: 400, body: { error: 'Yeni şifre en az 4 karakter olmalı.' } };
  const row = db.prepare('SELECT password_salt, password_hash FROM dealers WHERE id = ?').get(session.id);
  if (!row || !auth.checkPassword(currentPassword, row.password_salt, row.password_hash)) {
    return { status: 401, body: { error: 'Mevcut şifre hatalı.' } };
  }
  const cred = auth.makeCredential(newPassword);
  db.prepare('UPDATE dealers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, session.id);
  return { status: 200, body: { ok: true } };
}

/* Bayinin kendi profil bilgileri (ad/telefon/site) - admin.js:updateDealer'dan
   farkli olarak e-posta DEGISTIRILEMEZ (giris kimligi - yanlislikla kendini
   disari kilitleme riski), sadece admin degistirebilir. */
function getProfile(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const row = db.prepare('SELECT name, email, phone, website FROM dealers WHERE id = ?').get(session.id);
  if (!row) return { status: 404, body: { error: 'Bayi bulunamadı.' } };
  return { status: 200, body: { name: row.name, email: row.email, phone: row.phone || '', website: row.website || '' } };
}

async function updateProfile(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const website = String(body.website || '').trim();
  if (!name) return { status: 400, body: { error: 'Bayi adı boş bırakılamaz.' } };
  db.prepare('UPDATE dealers SET name = ?, phone = ?, website = ? WHERE id = ?').run(name, phone || null, website || null, session.id);
  return { status: 200, body: { ok: true } };
}

/* "Sifremi unuttum" - giris ekranindan, oturum olmadan cagrilir. Bayi
   e-postasiyla kendini tanimlar; kayitli telefonuna+onayli sms basligina
   yeni, rastgele bir sifre gonderilir. Guvenlik: hangi e-postanin sistemde
   olup olmadigini disariya sizdirmamak icin HER DURUMDA ayni genel mesaj
   donulur; IP bazli deneme kilidi de (auth.lockedForMs) SMS bombalamayi
   engeller. */
async function forgotPassword(req, res) {
  const ip = auth.clientIp(req);
  const wait = auth.lockedForMs(ip);
  if (wait > 0) return { status: 429, body: { error: `Çok fazla deneme. ${Math.ceil(wait / 1000)} saniye sonra tekrar deneyin.` } };
  const body = await auth.readJsonBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const generic = { status: 200, body: { ok: true, message: 'Bu e-posta sistemde kayıtlıysa ve bir telefon numarası tanımlıysa, o numaraya yeni şifre içeren bir SMS gönderildi.' } };
  if (!email) return generic;
  auth.registerFail(ip); // basarili da olsa deneme sayilir - SMS bombalamayi sinirlar
  const dealer = db.prepare('SELECT id, name, phone, sms_header FROM dealers WHERE email = ?').get(email);
  if (!dealer || !dealer.phone || !dealer.sms_header) return generic;
  const newPassword = auth.randomNumericPassword();
  const cred = auth.makeCredential(newPassword);
  db.prepare('UPDATE dealers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, dealer.id);
  const message = `AlfaPOS Bulut Bayi Paneli sifre sifirlama:\nKullanici adi: ${email}\nYeni sifre: ${newPassword}`;
  await sms.sendSms(dealer.phone, message, dealer.sms_header).catch(() => {});
  return generic;
}

module.exports = [
  { method: 'POST', path: '/api/dealer/login', handler: login },
  { method: 'POST', path: '/api/dealer/logout', handler: logout },
  { method: 'GET', path: '/api/dealer/profile', handler: getProfile },
  { method: 'POST', path: '/api/dealer/profile', handler: updateProfile },
  { method: 'POST', path: '/api/dealer/change-password', handler: changePassword },
  { method: 'POST', path: '/api/dealer/forgot-password', handler: forgotPassword }
];
