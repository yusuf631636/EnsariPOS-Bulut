const { db } = require('../db');
const auth = require('../auth');
const { generateUniqueActivationKey } = require('../lib/activation');
const sms = require('../lib/sms');

const CONNECTED_WINDOW_MS = 90 * 1000;

async function createDealer(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const commissionRate = Number(body.commissionRate || 0);
  const licenseQuota = body.licenseQuota === undefined || body.licenseQuota === null || body.licenseQuota === '' ? null : Number(body.licenseQuota);
  if (!name) return { status: 400, body: { error: 'Bayi adı gerekli.' } };
  if (!email || !email.includes('@')) return { status: 400, body: { error: 'Geçerli bir e-posta gerekli.' } };
  if (password.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  if (licenseQuota !== null && (!Number.isInteger(licenseQuota) || licenseQuota < 0)) return { status: 400, body: { error: 'Geçersiz lisans kotası.' } };
  const existing = db.prepare('SELECT 1 FROM dealers WHERE email = ?').get(email);
  if (existing) return { status: 409, body: { error: 'Bu e-posta ile kayıtlı bir bayi zaten var.' } };
  const cred = auth.makeCredential(password);
  const result = db.prepare('INSERT INTO dealers (name, email, password_salt, password_hash, commission_rate, license_quota) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, email, cred.salt, cred.hash, commissionRate, licenseQuota);
  return { status: 200, body: { ok: true, id: Number(result.lastInsertRowid) } };
}

function listDealers(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT d.id, d.name, d.email, d.phone, d.sms_header, d.commission_rate, d.license_quota, d.created_at, d.last_login_at,
           (SELECT COUNT(*) FROM customers c WHERE c.dealer_id = d.id) AS customer_count
    FROM dealers d ORDER BY d.created_at DESC
  `).all();
  return { status: 200, body: { dealers: rows } };
}

/* Bayi adi/e-posta/telefon/sms basligi guncelleme - musteri satirindaki
   ayni desen (updateCustomer). */
async function updateDealer(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const smsHeader = String(body.smsHeader || '').trim();
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (!name) return { status: 400, body: { error: 'Bayi adı boş bırakılamaz.' } };
  if (!email || !email.includes('@')) return { status: 400, body: { error: 'Geçerli bir e-posta gerekli.' } };
  const clash = db.prepare('SELECT 1 FROM dealers WHERE email = ? AND id != ?').get(email, id);
  if (clash) return { status: 409, body: { error: 'Bu e-posta başka bir bayide kayıtlı.' } };
  const fields = ['name = ?', 'email = ?', 'phone = ?', 'sms_header = ?'];
  const values = [name, email, phone || null, smsHeader || null];
  // licenseQuota: bos/undefined -> DOKUNULMAZ (mevcut deger kalir), null veya '' ACIKCA
  // gonderilirse SINIRSIZ yapilir - "kaç lisans vereceksem o kadar hakları olsun" (admin
  // kotayi ISTEDIGI zaman kaldirabilsin diye ayri bir durum olarak ele alinir).
  if (body.licenseQuota !== undefined) {
    const quota = body.licenseQuota === null || body.licenseQuota === '' ? null : Number(body.licenseQuota);
    if (quota !== null && (!Number.isInteger(quota) || quota < 0)) return { status: 400, body: { error: 'Geçersiz lisans kotası.' } };
    fields.push('license_quota = ?');
    values.push(quota);
  }
  db.prepare(`UPDATE dealers SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return { status: 200, body: { ok: true } };
}

/* Bayinin telefonuna giris bilgilerini SMS ile gonderir. Sifreler hash'li
   tutuldugu icin mevcut sifre GERI OKUNAMAZ - bu yuzden gonderim aninda
   yeni, rastgele bir sifre uretilir, hash'i kaydedilir ve duz metin hali
   SADECE bu SMS'te bir kereligine gorunur (yani bu buton ayni zamanda bir
   "sifre sifirlama" islemidir - onay metninde buna acikca deginiyoruz). */
async function sendDealerInfoSms(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const dealer = db.prepare('SELECT name, email, phone, sms_header FROM dealers WHERE id = ?').get(id);
  if (!dealer) return { status: 404, body: { error: 'Bayi bulunamadı.' } };
  if (!dealer.phone) return { status: 400, body: { error: 'Bu bayi için telefon numarası girilmemiş.' } };
  if (!dealer.sms_header) return { status: 400, body: { error: 'Bu bayi için onaylı SMS başlığı seçilmemiş.' } };
  // Admin panelde "Yeni şifre" kutusuna bir deger yazip SMS Gonder'e basarsa
  // O sifre gonderilir/atanir - bos birakilirsa eskisi gibi rastgele uretilir
  // ("636363 yazmissak o gitsin, degismesin" - onceden BURADA her tiklamada
  // rastgele bir sifre uretilip yazilan deger sessizce EZILIYORDU).
  const requestedPassword = String(body.password || '');
  if (requestedPassword && requestedPassword.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  const newPassword = requestedPassword || auth.randomNumericPassword();
  const cred = auth.makeCredential(newPassword);
  db.prepare('UPDATE dealers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, id);
  const message = `AlfaPOS Bulut Bayi Paneli giris bilgileriniz:\n` +
    `Bayi paneli: https://app.ornek-alanadi.com/dealer\n` +
    `Kullanici adi: ${dealer.email}\n` +
    `Sifre: ${newPassword}`;
  const result = await sms.sendSms(dealer.phone, message, dealer.sms_header);
  if (!result.ok) return { status: 502, body: { error: result.error || 'SMS gönderilemedi.' } };
  // Yeni sifre SADECE burada, bir kereligine duz metin olarak donuyor -
  // veritabaninda hep hash'li kalir, admin bunu bir daha geri goremez.
  return { status: 200, body: { ok: true, password: newPassword } };
}

/* Admin, bayi icin KENDI SECTIGI bir sifreyi dogrudan atar (rastgele
   uretilen SMS akisindan farkli olarak) - SMS gitmesini istemedigi,
   sadece "sifreyi ben belirleyeyim" dedigi durumlar icin. */
async function setDealerPassword(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const password = String(body.password || '');
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (password.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  const dealer = db.prepare('SELECT id FROM dealers WHERE id = ?').get(id);
  if (!dealer) return { status: 404, body: { error: 'Bayi bulunamadı.' } };
  const cred = auth.makeCredential(password);
  db.prepare('UPDATE dealers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, id);
  return { status: 200, body: { ok: true } };
}

function listCustomers(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT c.id, c.business_name, c.email, c.phone, c.sms_header, c.activation_key, c.gk_activation_key, c.gs_activation_key, c.ultra_activation_key, c.has_kurye, c.has_patron, c.has_qrmenu, c.has_gelismis_kurye, c.has_garson, c.has_ultra_paketci, c.has_kiosk, c.kiosk_activation_key, c.is_test, c.subscription_status, c.license_expires_at, c.created_at, c.last_login_at, d.name AS dealer_name, c.dealer_id,
           a.last_seen_at, g.last_seen_at AS gk_last_seen_at, s.last_seen_at AS gs_last_seen_at, u.last_seen_at AS ultra_last_seen_at, qm.last_seen_at AS qrmenu_last_seen_at
    FROM customers c
    JOIN dealers d ON d.id = c.dealer_id
    LEFT JOIN agent_status a ON a.customer_id = c.id
    LEFT JOIN gelismis_kurye_status g ON g.customer_id = c.id
    LEFT JOIN garson_status s ON s.customer_id = c.id
    LEFT JOIN ultra_paketci_status u ON u.customer_id = c.id
    LEFT JOIN qrmenu_status qm ON qm.customer_id = c.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at DESC
  `).all();
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const customers = rows.map(r => ({
    ...r,
    connected: !!(r.last_seen_at && (now - Number(r.last_seen_at)) < CONNECTED_WINDOW_MS),
    gkConnected: !!(r.gk_last_seen_at && (now - Number(r.gk_last_seen_at)) < CONNECTED_WINDOW_MS),
    gsConnected: !!(r.gs_last_seen_at && (now - Number(r.gs_last_seen_at)) < CONNECTED_WINDOW_MS),
    ultraConnected: !!(r.ultra_last_seen_at && (now - Number(r.ultra_last_seen_at)) < CONNECTED_WINDOW_MS),
    qrmenuConnected: !!(r.qrmenu_last_seen_at && (now - Number(r.qrmenu_last_seen_at)) < CONNECTED_WINDOW_MS),
    licenseExpired: !!(r.license_expires_at && r.license_expires_at < today)
  }));
  return { status: 200, body: { customers } };
}

function isValidDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || ''); }

async function createCustomer(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const dealerId = Number(body.dealerId);
  const businessName = String(body.businessName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const licenseExpiresAt = String(body.licenseExpiresAt || '').trim();
  if (password && password.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  const hasKurye = body.hasKurye !== false ? 1 : 0;
  const hasPatron = body.hasPatron !== false ? 1 : 0;
  const hasQrmenu = body.hasQrmenu === true ? 1 : 0; // digerlerinden farkli: varsayilan KAPALI (opt-in)
  const hasGelismisKurye = body.hasGelismisKurye === true ? 1 : 0; // opt-in, QR Menu ile ayni desen
  const hasGarson = body.hasGarson === true ? 1 : 0; // opt-in, GelismisKurye ile ayni desen
  const hasUltraPaketci = body.hasUltraPaketci === true ? 1 : 0; // opt-in, GelismisKurye ile ayni desen ama KENDI anahtari
  const hasKiosk = body.hasKiosk === true ? 1 : 0; // opt-in, KENDI ayri kiosk anahtari
  if (!dealerId) return { status: 400, body: { error: 'Bayi seçimi gerekli.' } };
  if (!businessName) return { status: 400, body: { error: 'İşletme adı gerekli.' } };
  if (email && !email.includes('@')) return { status: 400, body: { error: 'Geçersiz e-posta.' } };
  if (licenseExpiresAt && !isValidDate(licenseExpiresAt)) return { status: 400, body: { error: 'Geçersiz lisans tarihi.' } };
  const dealer = db.prepare('SELECT id FROM dealers WHERE id = ?').get(dealerId);
  if (!dealer) return { status: 404, body: { error: 'Bayi bulunamadı.' } };
  const activationKey = generateUniqueActivationKey(db);
  const gkActivationKey = hasGelismisKurye ? generateUniqueActivationKey(db, 'gk_activation_key') : null;
  const gsActivationKey = hasGarson ? generateUniqueActivationKey(db, 'gs_activation_key') : null;
  const ultraActivationKey = hasUltraPaketci ? generateUniqueActivationKey(db, 'ultra_activation_key') : null;
  const kioskActivationKey = hasKiosk ? generateUniqueActivationKey(db, 'kiosk_activation_key') : null;
  // Sifre burada dogrudan verilirse (admin panelinden musteriye ELDEN teslim
  // edilecekse) musteri kendi "aktivasyon anahtariyla ilk sifreyi belirleme"
  // adimina hic girmeden dogrudan giris yapabilir - bkz. routes/customer.js
  // activate() (password_hash zaten doluysa 409 doner, o akis atlanir).
  const cred = password ? auth.makeCredential(password) : null;
  const result = db.prepare('INSERT INTO customers (dealer_id, business_name, email, phone, activation_key, password_salt, password_hash, license_expires_at, has_kurye, has_patron, has_qrmenu, has_gelismis_kurye, gk_activation_key, has_garson, gs_activation_key, has_ultra_paketci, ultra_activation_key, has_kiosk, kiosk_activation_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(dealerId, businessName, email || null, phone || null, activationKey, cred ? cred.salt : null, cred ? cred.hash : null, licenseExpiresAt || null, hasKurye, hasPatron, hasQrmenu, hasGelismisKurye, gkActivationKey, hasGarson, gsActivationKey, hasUltraPaketci, ultraActivationKey, hasKiosk, kioskActivationKey);
  return { status: 200, body: { ok: true, id: Number(result.lastInsertRowid), activationKey, gkActivationKey, gsActivationKey, ultraActivationKey, kioskActivationKey, businessName, email, password: password || null } };
}

async function setSubscriptionStatus(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const status = String(body.status || '');
  if (!id || !['active', 'suspended'].includes(status)) return { status: 400, body: { error: 'Geçersiz istek.' } };
  db.prepare('UPDATE customers SET subscription_status = ? WHERE id = ?').run(status, id);
  return { status: 200, body: { ok: true } };
}

/* Musteri silme - YUMUSAK silme: satir veritabanindan SILINMEZ, sadece
   deleted_at damgalanir. Boylece yanlislikla silinen bir musterinin lisans
   anahtari, kurye/QR menu/Patron gecmisi KAYBOLMAZ - "Son silinenler"den geri
   getirilebilir. Kaza ile aktif bir musterinin silinmesini onlemek icin
   SADECE zaten askiya alinmis (pasif) musteriler silinebilir - once
   "Askiya al", sonra "Sil" iki ayri, bilincli adim olsun diye. */
async function deleteCustomer(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  const customer = db.prepare('SELECT id, subscription_status, deleted_at FROM customers WHERE id = ?').get(id);
  if (!customer || customer.deleted_at) return { status: 404, body: { error: 'Müşteri bulunamadı.' } };
  if (customer.subscription_status !== 'suspended') return { status: 400, body: { error: 'Sadece askıya alınmış (pasif) müşteriler silinebilir. Önce müşteriyi askıya alın.' } };
  db.prepare('UPDATE customers SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return { status: 200, body: { ok: true } };
}

function listDeletedCustomers(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT c.id, c.business_name, c.activation_key, d.name AS dealer_name, c.deleted_at
    FROM customers c JOIN dealers d ON d.id = c.dealer_id
    WHERE c.deleted_at IS NOT NULL
    ORDER BY c.deleted_at DESC
  `).all();
  return { status: 200, body: { customers: rows } };
}

async function restoreCustomer(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  const customer = db.prepare('SELECT id, deleted_at FROM customers WHERE id = ?').get(id);
  if (!customer || !customer.deleted_at) return { status: 404, body: { error: 'Silinmiş müşteri bulunamadı.' } };
  // Geri getirilen musteri guvenlik geregi ASKIDA kalir - admin bilerek tekrar aktif etmeli.
  db.prepare('UPDATE customers SET deleted_at = NULL WHERE id = ?').run(id);
  return { status: 200, body: { ok: true } };
}

/* Lisans bitis tarihini yeniler/degistirir - bos deger gonderilirse "sinirsiz" olur. */
async function setLicenseExpiry(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const licenseExpiresAt = String(body.licenseExpiresAt || '').trim();
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (licenseExpiresAt && !isValidDate(licenseExpiresAt)) return { status: 400, body: { error: 'Geçersiz tarih.' } };
  db.prepare('UPDATE customers SET license_expires_at = ? WHERE id = ?').run(licenseExpiresAt || null, id);
  return { status: 200, body: { ok: true } };
}

/* Isletme adi ve/veya e-posta guncelleme - musteri girisinde artik e-posta
   da kabul edildigi icin (uzun isletme adi yazmak yerine) admin bunu burada
   atayabilir/duzeltebilir. */
async function updateCustomer(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const businessName = String(body.businessName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const smsHeader = String(body.smsHeader || '').trim();
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (!businessName) return { status: 400, body: { error: 'İşletme adı boş bırakılamaz.' } };
  if (email && !email.includes('@')) return { status: 400, body: { error: 'Geçersiz e-posta.' } };
  const fields = ['business_name = ?', 'email = ?', 'phone = ?', 'sms_header = ?'];
  const values = [businessName, email || null, phone || null, smsHeader || null];
  if (body.hasKurye !== undefined) { fields.push('has_kurye = ?'); values.push(body.hasKurye ? 1 : 0); }
  if (body.hasPatron !== undefined) { fields.push('has_patron = ?'); values.push(body.hasPatron ? 1 : 0); }
  if (body.hasQrmenu !== undefined) { fields.push('has_qrmenu = ?'); values.push(body.hasQrmenu ? 1 : 0); }
  if (body.isTest !== undefined) { fields.push('is_test = ?'); values.push(body.isTest ? 1 : 0); }
  let newGkKey = null;
  if (body.hasGelismisKurye !== undefined) {
    fields.push('has_gelismis_kurye = ?'); values.push(body.hasGelismisKurye ? 1 : 0);
    // Gelismis Kurye ilk kez aciliyorsa VE henuz kendi anahtari yoksa, otomatik uretilir -
    // diger 3 urunden AYRI bir anahtar (13.09.2026'da eklendi, canli bir karisiklik sonrasi).
    if (body.hasGelismisKurye) {
      const current = db.prepare('SELECT gk_activation_key FROM customers WHERE id = ?').get(id);
      if (current && !current.gk_activation_key) {
        newGkKey = generateUniqueActivationKey(db, 'gk_activation_key');
        fields.push('gk_activation_key = ?'); values.push(newGkKey);
      }
    }
  }
  // Garson Sistemi - Gelismis Kurye ile AYNI desen (13.09.2026, ayni gun eklendi).
  let newGsKey = null;
  if (body.hasGarson !== undefined) {
    fields.push('has_garson = ?'); values.push(body.hasGarson ? 1 : 0);
    if (body.hasGarson) {
      const current = db.prepare('SELECT gs_activation_key FROM customers WHERE id = ?').get(id);
      if (current && !current.gs_activation_key) {
        newGsKey = generateUniqueActivationKey(db, 'gs_activation_key');
        fields.push('gs_activation_key = ?'); values.push(newGsKey);
      }
    }
  }
  // Ultra Paketci - Gelismis Kurye ile AYNI desen AMA KENDI AYRI anahtari (15.09.2026,
  // ayni restoranda ikisinin AYNI anahtarla tunele baglanip birbirinin yerini almasi -
  // "ultra.ornek-alanadi.com Gelismis Kurye verisini gosteriyor" - canli tespit edilip
  // ayrildiktan sonra eklendi).
  let newUltraKey = null;
  if (body.hasUltraPaketci !== undefined) {
    fields.push('has_ultra_paketci = ?'); values.push(body.hasUltraPaketci ? 1 : 0);
    if (body.hasUltraPaketci) {
      const current = db.prepare('SELECT ultra_activation_key FROM customers WHERE id = ?').get(id);
      if (current && !current.ultra_activation_key) {
        newUltraKey = generateUniqueActivationKey(db, 'ultra_activation_key');
        fields.push('ultra_activation_key = ?'); values.push(newUltraKey);
      }
    }
  }
  // Kiosk - Ultra ile AYNI desen, KENDI AYRI anahtari (03.10.2026). AYRI kiosk lisansi.
  let newKioskKey = null;
  if (body.hasKiosk !== undefined) {
    fields.push('has_kiosk = ?'); values.push(body.hasKiosk ? 1 : 0);
    if (body.hasKiosk) {
      const current = db.prepare('SELECT kiosk_activation_key FROM customers WHERE id = ?').get(id);
      if (current && !current.kiosk_activation_key) {
        newKioskKey = generateUniqueActivationKey(db, 'kiosk_activation_key');
        fields.push('kiosk_activation_key = ?'); values.push(newKioskKey);
      }
    }
  }
  db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return { status: 200, body: { ok: true, gkActivationKey: newGkKey, gsActivationKey: newGsKey, ultraActivationKey: newUltraKey, kioskActivationKey: newKioskKey } };
}

/* Bu hesaptaki onaylanmis SMS basliklarini (originator) dondurur - admin
   panelinde secim listesi doldurmak icin. */
async function listSmsHeaders(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const headers = await sms.listHeaders();
  return { status: 200, body: { headers } };
}

/* Musterinin telefonuna, panel linklerini ve aktivasyon anahtarini SMS ile
   gonderir. Musterinin kendi sms_header'i (bkz. updateCustomer) kullanilir -
   atanmamissa hata doner, once bir baslik secilmesi istenir. Musteri panelinde
   parola hic belirlenmemisse (ilk kurulum), rastgele bir sifre uretilir ve
   dogrudan atanip SMS'e eklenir - boylece musteri "aktivasyon" adimina hic
   gerek kalmadan musteri adi/e-posta + bu sifreyle direkt giris yapabilir.
   Zaten sifresi varsa dokunulmaz, aktivasyon anahtari yine de gonderilir. */
async function sendInfoSms(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const customer = db.prepare('SELECT business_name, phone, sms_header, activation_key, password_hash FROM customers WHERE id = ?').get(id);
  if (!customer) return { status: 404, body: { error: 'Restoran bulunamadı.' } };
  if (!customer.phone) return { status: 400, body: { error: 'Bu restoran için telefon numarası girilmemiş.' } };
  if (!customer.sms_header) return { status: 400, body: { error: 'Bu restoran için onaylı SMS başlığı seçilmemiş.' } };
  // Admin "Yeni şifre" kutusuna deger yazip SMS Gonder'e basarsa O sifre
  // atanir/gonderilir; bos birakilirsa SADECE hic sifresi yoksa rastgele
  // uretilir - zaten sifresi olan bir musterinin sifresi burada SESSIZCE
  // degistirilmez (sendDealerInfoSms ile ayni fikir, bkz. yukaridaki yorum).
  const requestedPassword = String(body.password || '');
  if (requestedPassword && requestedPassword.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  let newPassword = requestedPassword || null;
  if (!customer.password_hash && !newPassword) newPassword = auth.randomNumericPassword();
  if (newPassword) {
    const cred = auth.makeCredential(newPassword);
    db.prepare('UPDATE customers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, id);
  }
  const message = `AlfaPOS Bulut giris bilgileriniz:\n` +
    `Musteri/Patron paneli: https://patron2.ornek-alanadi.com\n` +
    `Kurye paneli: https://kuryebulut.ornek-alanadi.com\n` +
    `Aktivasyon anahtari: ${customer.activation_key}` +
    (newPassword ? `\nSifre: ${newPassword}` : '');
  const result = await sms.sendSms(customer.phone, message, customer.sms_header);
  if (!result.ok) return { status: 502, body: { error: result.error || 'SMS gönderilemedi.' } };
  return { status: 200, body: { ok: true, password: newPassword } };
}

/* Admin, musteri panel sifresini KENDI SECTIGI bir degerle dogrudan atar
   (setDealerPassword ile ayni desen) - SMS gondermeden, sadece "sifreyi ben
   belirleyeyim/gorecegim" dedigi durumlar icin. */
async function setCustomerPassword(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const password = String(body.password || '');
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (password.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
  if (!customer) return { status: 404, body: { error: 'Restoran bulunamadı.' } };
  const cred = auth.makeCredential(password);
  db.prepare('UPDATE customers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, id);
  return { status: 200, body: { ok: true } };
}

/* Indirme sayaclarini (routes/track.js tarafindan artirilir) admin panelde
   gostermek icin - hangi kurulum dosyasi kac kez indirilmis, en son ne
   zaman. */
function downloadStats(req, res, session) {
  if (!auth.requireRole('admin')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare('SELECT file, count, last_at FROM download_counts').all();
  return { status: 200, body: { downloads: rows } };
}

module.exports = [
  { method: 'GET', path: '/api/admin/download-stats', handler: downloadStats },
  { method: 'POST', path: '/api/admin/dealers', handler: createDealer },
  { method: 'GET', path: '/api/admin/dealers', handler: listDealers },
  { method: 'POST', path: '/api/admin/dealers/update', handler: updateDealer },
  { method: 'POST', path: '/api/admin/dealers/send-info-sms', handler: sendDealerInfoSms },
  { method: 'POST', path: '/api/admin/dealers/set-password', handler: setDealerPassword },
  { method: 'GET', path: '/api/admin/customers', handler: listCustomers },
  { method: 'POST', path: '/api/admin/customers', handler: createCustomer },
  { method: 'POST', path: '/api/admin/customers/status', handler: setSubscriptionStatus },
  { method: 'POST', path: '/api/admin/customers/delete', handler: deleteCustomer },
  { method: 'POST', path: '/api/admin/customers/restore', handler: restoreCustomer },
  { method: 'GET', path: '/api/admin/customers/deleted', handler: listDeletedCustomers },
  { method: 'POST', path: '/api/admin/customers/license', handler: setLicenseExpiry },
  { method: 'POST', path: '/api/admin/customers/update', handler: updateCustomer },
  { method: 'GET', path: '/api/admin/sms-headers', handler: listSmsHeaders },
  { method: 'POST', path: '/api/admin/customers/send-info-sms', handler: sendInfoSms },
  { method: 'POST', path: '/api/admin/customers/set-password', handler: setCustomerPassword }
];
