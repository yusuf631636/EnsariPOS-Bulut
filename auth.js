/* server.js'deki (C:\ensari\server.js, satir 63-134) tek-kullanicili auth deseninin
   coklu-kiracili (rol+id tasiyan oturum) uyarlamasi. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* Uygulamalar artik telefonda APK olarak kuruluyor ve "arka planda sessizce
   calissin, cikis yapilmadigi surece sifre sorulmasin" istendi (13.09.2026).
   Bunun icin IKI sey gerekiyordu: (1) cerez/oturum suresini cok uzun tutmak,
   (2) oturumlari SADECE bellekte degil DISKTE de tutmak - yoksa servis her
   yeniden baslatildiginda (biz bir guncelleme yayinladigimizda dahi) TUM
   musteriler aninda "cikis yapilmis" gibi sifre ekranina duserdi. */
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 gun, her istekte yenilenir
const LOCK_THRESHOLD = 5, LOCK_MS = 5 * 60 * 1000;
/* Her rol AYRI cerez kullanir - ayni tarayicida (orn. bir restoranin kendi
   bilgisayarinda) birden fazla rol test edilince birinin sessizce digerini
   gecersiz kilmasini onler (C:\kurye takip'te yasanan gercek bir hatanin
   ayni cozumu). */
const COOKIE_NAMES = { admin: 'ensari_admin_session', dealer: 'ensari_dealer_session', customer: 'ensari_customer_session', courier: 'ensari_courier_session' };
const ROLE_ORDER = ['admin', 'dealer', 'customer', 'courier'];

/* Oturumlari bir JSON dosyasina yansitir - servis yeniden baslasa (deploy,
   restart) bile musteriler oturumda kalir. Her SET/DELETE'te (giris/cikis)
   yazilir; kaydirmali yenilemede (her istek) YAZILMAZ - performans icin, ve
   zaten 180 gunluk surede birkac dakikalik gecikme onemsiz. */
const SESSIONS_FILE = path.join(__dirname, 'data', 'sessions.json');
function loadSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const map = new Map();
    const now = Date.now();
    for (const [token, record] of Object.entries(raw)) {
      if (record.expires > now) map.set(token, record);
    }
    return map;
  } catch { return new Map(); }
}
function persistSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))); }
  catch { /* diske yazilamazsa sessizce gec - oturum yine de bellekte calismaya devam eder */ }
}
const sessions = loadSessions(); // token -> {role, id, extra, expires}
const attempts = new Map(); // ip -> {count, lockUntil}

function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function makeCredential(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(password, salt) };
}
function checkPassword(password, salt, hash) {
  if (!password || typeof password !== 'string' || !salt || !hash) return false;
  const attempt = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
}
/* SMS ile gonderilen "yeni sifre" harf+sembol karisik (base64url) oldugunda
   telefonda elle yazmak zor oluyordu - restoran/bayi sahipleri icin SADECE
   RAKAM istendi (13.09.2026). SambaPOS PIN'lerine benzer, tanidik bir bicim. */
function randomNumericPassword(digits = 6) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}
function parseCookies(req) {
  const header = req.headers.cookie, out = {};
  if (!header) return out;
  header.split(';').forEach(part => { const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted; }
function setSessionCookie(req, res, token, role) {
  const parts = [`${COOKIE_NAMES[role]}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(req, res) {
  const isHttp = isHttps(req);
  const cookies = Object.values(COOKIE_NAMES).map(name => {
    const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isHttp) parts.push('Secure');
    return parts.join('; ');
  });
  res.setHeader('Set-Cookie', cookies);
}
function newSession(role, id, extra) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role, id, extra: extra || {}, expires: Date.now() + SESSION_TTL_MS });
  persistSessions();
  return token;
}
function currentSession(req) {
  const cookies = parseCookies(req);
  for (const role of ROLE_ORDER) {
    const token = cookies[COOKIE_NAMES[role]];
    if (!token || !sessions.has(token)) continue;
    const record = sessions.get(token);
    if (record.expires < Date.now()) { sessions.delete(token); continue; }
    record.expires = Date.now() + SESSION_TTL_MS; // kaydirmali oturum
    return { token, role: record.role, id: record.id, ...record.extra };
  }
  return null;
}
/* currentSession() sabit bir oncelik sirasiyla (admin > dealer > customer >
   courier) ILK gecerli cerezi doner - ayni tarayicida hem admin HEM musteri
   oturumu ACIKKEN musteri panelinin kendi cerezi GECERLI olsa bile admin
   oturumu "kazanir" ve requireRole('customer') sessizce reddeder (gercek bir
   hatada yasandi: admin panelinden musteri eklendi, ayni tarayicida musteri
   panelinde "Oturum gerekli" gorundu). server.js bu yuzden hangi rolun
   cerezine bakilacagini URL'den (/api/<rol>/...) bilip DOGRUDAN o cerezi
   sorar - once/sonra siralamasi karismasin diye. */
function sessionForRole(req, role) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAMES[role]];
  if (!token || !sessions.has(token)) return null;
  const record = sessions.get(token);
  if (record.expires < Date.now()) { sessions.delete(token); return null; }
  record.expires = Date.now() + SESSION_TTL_MS;
  return { token, role: record.role, id: record.id, ...record.extra };
}
function destroySession(req) {
  const cookies = parseCookies(req);
  let changed = false;
  for (const role of ROLE_ORDER) {
    const token = cookies[COOKIE_NAMES[role]];
    if (token && sessions.delete(token)) changed = true;
  }
  if (changed) persistSessions();
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function lockedForMs(ip) { const state = attempts.get(ip); return state && state.lockUntil > Date.now() ? state.lockUntil - Date.now() : 0; }
function registerFail(ip) {
  const state = attempts.get(ip) || { count: 0, lockUntil: 0 };
  state.count += 1;
  if (state.count >= LOCK_THRESHOLD) { state.lockUntil = Date.now() + LOCK_MS; state.count = 0; }
  attempts.set(ip, state);
}
function registerSuccess(ip) { attempts.delete(ip); }
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(new Error('İstek çok büyük.')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function requireRole(role) {
  return (req, res, session) => {
    if (!session || session.role !== role) return false;
    return true;
  };
}

module.exports = {
  makeCredential, checkPassword, randomNumericPassword, newSession, currentSession, sessionForRole, destroySession,
  setSessionCookie, clearSessionCookie, clientIp, lockedForMs, registerFail, registerSuccess,
  readJsonBody, requireRole
};
