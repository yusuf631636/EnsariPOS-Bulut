const { db } = require('../db');
const auth = require('../auth');
const { generateUniqueActivationKey } = require('../lib/activation');

const CONNECTED_WINDOW_MS = 90 * 1000;
/* Urun fiyatlari (USD) - bayi panelinde ve yeni restoran olustururken
   gosterilir. Sadece bilgilendirme amaclidir, sistemde otomatik tahsilat
   yapilmaz; bayi musteriden bu tutari kendisi tahsil eder. */
const PRICE_USD = { kurye: 50, patron: 50 };

function listCustomers(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT c.id, c.business_name, c.email, c.phone, c.activation_key, c.gk_activation_key, c.ultra_activation_key, c.kiosk_activation_key, c.has_kurye, c.has_patron, c.has_qrmenu, c.has_gelismis_kurye, c.has_ultra_paketci, c.has_kiosk,
           c.subscription_status, c.license_expires_at, c.created_at, c.last_login_at,
           a.last_seen_at, s.updated_at AS snapshot_updated_at, g.last_seen_at AS gk_last_seen_at, u.last_seen_at AS ultra_last_seen_at
    FROM customers c
    LEFT JOIN agent_status a ON a.customer_id = c.id
    LEFT JOIN customer_snapshots s ON s.customer_id = c.id
    LEFT JOIN gelismis_kurye_status g ON g.customer_id = c.id
    LEFT JOIN ultra_paketci_status u ON u.customer_id = c.id
    WHERE c.dealer_id = ? AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC
  `).all(session.id);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const customers = rows.map(r => ({
    ...r,
    connected: !!(r.last_seen_at && (now - Number(r.last_seen_at)) < CONNECTED_WINDOW_MS),
    gkConnected: !!(r.gk_last_seen_at && (now - Number(r.gk_last_seen_at)) < CONNECTED_WINDOW_MS),
    ultraConnected: !!(r.ultra_last_seen_at && (now - Number(r.ultra_last_seen_at)) < CONNECTED_WINDOW_MS),
    licenseExpired: !!(r.license_expires_at && r.license_expires_at < today)
  }));
  const dealer = db.prepare('SELECT license_quota FROM dealers WHERE id = ?').get(session.id);
  return { status: 200, body: { customers, quota: dealer.license_quota, used: rows.length } };
}

/* Bayi kendi musterisini (restoranini) dogrudan burada olusturur - admin
   onayi/mudahalesi gerekmez, dealer_id her zaman kendi oturumundan alinir.
   En az bir urun secilmis olmali (0 urunlu bir lisansin anlami yok). */
async function createCustomer(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const businessName = String(body.businessName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const hasKurye = !!body.hasKurye;
  const hasPatron = !!body.hasPatron;
  const hasQrmenu = !!body.hasQrmenu;
  const hasGelismisKurye = !!body.hasGelismisKurye;
  if (!businessName) return { status: 400, body: { error: 'İşletme adı gerekli.' } };
  if (email && !email.includes('@')) return { status: 400, body: { error: 'Geçersiz e-posta.' } };
  if (!hasKurye && !hasPatron) return { status: 400, body: { error: 'En az bir ürün seçmelisiniz.' } };
  // Admin panelinden atanan lisans kotasi - "kaç lisans vereceksem o kadar
  // hakları olsun" - kota NULL ise sinirsiz, aksi halde mevcut musteri sayisi
  // kotaya ulastiginda yeni musteri eklenemez.
  const dealer = db.prepare('SELECT license_quota FROM dealers WHERE id = ?').get(session.id);
  if (dealer.license_quota !== null && dealer.license_quota !== undefined) {
    const used = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE dealer_id = ? AND deleted_at IS NULL').get(session.id).n;
    if (used >= dealer.license_quota) {
      return { status: 403, body: { error: `Lisans kotanız doldu (${used}/${dealer.license_quota}). Yeni müşteri eklemek için yöneticinizle iletişime geçin.` } };
    }
  }
  const activationKey = generateUniqueActivationKey(db);
  const result = db.prepare('INSERT INTO customers (dealer_id, business_name, email, phone, activation_key, has_kurye, has_patron, has_qrmenu, has_gelismis_kurye) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(session.id, businessName, email || null, phone || null, activationKey, hasKurye ? 1 : 0, hasPatron ? 1 : 0, hasQrmenu ? 1 : 0, hasGelismisKurye ? 1 : 0);
  const totalUsd = (hasKurye ? PRICE_USD.kurye : 0) + (hasPatron ? PRICE_USD.patron : 0);
  return { status: 200, body: { ok: true, id: Number(result.lastInsertRowid), activationKey, totalUsd } };
}

/* Musteri duzenleme - admin.js:updateCustomer ile AYNI desen, ama SADECE
   kendi musterisi uzerinde: sahiplik kontrolu (dealer_id = session.id)
   olmadan bir bayi baska bir bayinin musterisini duzenleyebilirdi. */
async function updateCustomer(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const businessName = String(body.businessName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (!businessName) return { status: 400, body: { error: 'İşletme adı boş bırakılamaz.' } };
  if (email && !email.includes('@')) return { status: 400, body: { error: 'Geçersiz e-posta.' } };
  const owned = db.prepare('SELECT id FROM customers WHERE id = ? AND dealer_id = ?').get(id, session.id);
  if (!owned) return { status: 404, body: { error: 'Müşteri bulunamadı.' } };
  const fields = ['business_name = ?', 'email = ?', 'phone = ?'];
  const values = [businessName, email || null, phone || null];
  if (body.hasKurye !== undefined) { fields.push('has_kurye = ?'); values.push(body.hasKurye ? 1 : 0); }
  if (body.hasPatron !== undefined) { fields.push('has_patron = ?'); values.push(body.hasPatron ? 1 : 0); }
  if (body.hasQrmenu !== undefined) { fields.push('has_qrmenu = ?'); values.push(body.hasQrmenu ? 1 : 0); }
  let newGkKey = null;
  if (body.hasGelismisKurye !== undefined) {
    fields.push('has_gelismis_kurye = ?'); values.push(body.hasGelismisKurye ? 1 : 0);
    if (body.hasGelismisKurye) {
      const current = db.prepare('SELECT gk_activation_key FROM customers WHERE id = ?').get(id);
      if (current && !current.gk_activation_key) {
        newGkKey = generateUniqueActivationKey(db, 'gk_activation_key');
        fields.push('gk_activation_key = ?'); values.push(newGkKey);
      }
    }
  }
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
  return { status: 200, body: { ok: true, gkActivationKey: newGkKey, ultraActivationKey: newUltraKey, kioskActivationKey: newKioskKey } };
}

/* Bayi, kendi musterisinin panel sifresini dogrudan atar - admin.js:setCustomerPassword
   ile ayni desen, ayni sahiplik kontroluyle. */
async function setCustomerPassword(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const password = String(body.password || '');
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (password.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  const owned = db.prepare('SELECT id FROM customers WHERE id = ? AND dealer_id = ?').get(id, session.id);
  if (!owned) return { status: 404, body: { error: 'Müşteri bulunamadı.' } };
  const cred = auth.makeCredential(password);
  db.prepare('UPDATE customers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, id);
  return { status: 200, body: { ok: true } };
}

function isValidDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || ''); }

/* Lisans bitis tarihini yenileme - admin.js:setLicenseExpiry ile AYNI desen,
   ayni sahiplik kontroluyle (updateCustomer/setCustomerPassword ile birebir
   ayni satir). Bayi musterisini duzenleyebilsin isteginin bir parcasi
   (15.09.2026) - eskiden SADECE admin lisans tarihini degistirebiliyordu. */
async function setLicenseExpiry(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const licenseExpiresAt = String(body.licenseExpiresAt || '').trim();
  if (!id) return { status: 400, body: { error: 'Geçersiz istek.' } };
  if (licenseExpiresAt && !isValidDate(licenseExpiresAt)) return { status: 400, body: { error: 'Geçersiz tarih.' } };
  const owned = db.prepare('SELECT id FROM customers WHERE id = ? AND dealer_id = ?').get(id, session.id);
  if (!owned) return { status: 404, body: { error: 'Müşteri bulunamadı.' } };
  db.prepare('UPDATE customers SET license_expires_at = ? WHERE id = ?').run(licenseExpiresAt || null, id);
  return { status: 200, body: { ok: true } };
}

/* Askiya alma/aktif etme - admin.js:setSubscriptionStatus ile AYNI desen.
   Bir musteri odemeyi biraktiginda bayinin admin'e sormadan kendisi
   kapatabilmesi icin. */
async function setSubscriptionStatus(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const id = Number(body.id);
  const status = String(body.status || '');
  if (!id || !['active', 'suspended'].includes(status)) return { status: 400, body: { error: 'Geçersiz istek.' } };
  const owned = db.prepare('SELECT id FROM customers WHERE id = ? AND dealer_id = ?').get(id, session.id);
  if (!owned) return { status: 404, body: { error: 'Müşteri bulunamadı.' } };
  db.prepare('UPDATE customers SET subscription_status = ? WHERE id = ?').run(status, id);
  return { status: 200, body: { ok: true } };
}

function prices(req, res, session) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  return { status: 200, body: { prices: PRICE_USD } };
}

function customerSummary(req, res, session, query) {
  if (!auth.requireRole('dealer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const id = Number(query.get('id'));
  if (!id) return { status: 400, body: { error: 'id gerekli.' } };
  const customer = db.prepare('SELECT id, business_name, dealer_id FROM customers WHERE id = ?').get(id);
  if (!customer || customer.dealer_id !== session.id) return { status: 404, body: { error: 'Müşteri bulunamadı.' } };
  const row = db.prepare('SELECT payload, updated_at FROM customer_snapshots WHERE customer_id = ?').get(id);
  return {
    status: 200,
    body: {
      businessName: customer.business_name,
      updatedAt: row ? row.updated_at : null,
      data: row ? JSON.parse(row.payload) : null
    }
  };
}

module.exports = [
  { method: 'GET', path: '/api/dealer/customers', handler: listCustomers },
  { method: 'POST', path: '/api/dealer/customers', handler: createCustomer },
  { method: 'POST', path: '/api/dealer/customers/update', handler: updateCustomer },
  { method: 'POST', path: '/api/dealer/customers/set-password', handler: setCustomerPassword },
  { method: 'POST', path: '/api/dealer/customers/license', handler: setLicenseExpiry },
  { method: 'POST', path: '/api/dealer/customers/status', handler: setSubscriptionStatus },
  { method: 'GET', path: '/api/dealer/customer-summary', handler: customerSummary },
  { method: 'GET', path: '/api/dealer/prices', handler: prices }
];
