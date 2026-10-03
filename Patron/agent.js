const { db } = require('../db');
const auth = require('../auth');
const { licenseActive } = require('../lib/license');

/* Restoran tarafi (C:\ensari\server.js) her 15 saniyede bir buraya push eder.
   Kimlik dogrulama icin ayri bir token yok - zaten musteriye ozel olan
   activation_key yeniden kullanilir. Baglanti durumu burada SAKLANMAZ;
   admin/dealer listelerinde last_seen_at'in yakinligina bakilarak hesaplanir
   (boylece restoran kapandiginda "bagli" gorunmeye devam etmez). */
async function push(req, res) {
  const body = await auth.readJsonBody(req);
  const activationKey = String(body.activationKey || '').trim();
  if (!activationKey) return { status: 400, body: { error: 'activationKey gerekli.' } };
  const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_patron FROM customers WHERE activation_key = ? AND deleted_at IS NULL').get(activationKey);
  if (!customer) return { status: 403, body: { error: 'Geçersiz aktivasyon anahtarı.' } };
  if (!licenseActive(customer)) return { status: 403, body: { error: 'Abonelik aktif değil veya lisans süresi dolmuş.' } };
  if (!customer.has_patron) return { status: 403, body: { error: 'Patron Raporu lisansınız yok.' } };

  const payload = JSON.stringify({
    sales: body.sales || null,
    openTables: body.openTables || null,
    notifications: body.notifications || null,
    courier: body.courier || null,
    // 30.09.2026 (C# ajan 2.1+): dunle/gecen haftayla kiyas + restoranin saati (acik masa sureleri icin).
    // Eski ajanlar gondermez -> null, panel kiyaslari gizler.
    compare: body.compare || null,
    clock: typeof body.clock === 'string' ? body.clock.slice(0, 19) : null
  });
  const now = Date.now(); // unix ms - SQL tarafinda tarih ayristirma belirsizligi olmasin diye
  db.prepare(`
    INSERT INTO customer_snapshots (customer_id, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(customer.id, payload, now);
  db.prepare(`
    INSERT INTO agent_status (customer_id, connected, last_seen_at) VALUES (?, 1, ?)
    ON CONFLICT(customer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(customer.id, now);

  // Ajan HER SEFERINDE sadece "bugun"un ozetini gonderiyor (customer_snapshots
  // bunu UZERINE yazar, gecmis TUTMAZ) - o yuzden gun bazinda ayrica arsivlenir.
  // Boylece "Patron Raporu" sekmesinde tarih araligi sorgulanabilir hale gelir,
  // ajanin kendisine HICBIR degisiklik gerekmez.
  const summary = body.sales && body.sales.summary;
  if (summary) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      INSERT INTO patron_daily_reports (customer_id, report_date, sales, tickets, average, remaining, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(customer_id, report_date) DO UPDATE SET
        sales = excluded.sales, tickets = excluded.tickets, average = excluded.average,
        remaining = excluded.remaining, updated_at = excluded.updated_at
    `).run(customer.id, today, Number(summary.sales) || 0, Number(summary.tickets) || 0, Number(summary.average) || 0, Number(summary.remaining) || 0, now);
  }

  // Menu/fiyat listesinin bulut aynasi - musteri panelinden fiyat guncelleme
  // aramasi icin. courier_orders'daki AYNI "sil + yeniden yaz" deseni
  // (patron_menu_items sadece bir ayna, saklanacak QR-menu tarzi ek alan yok).
  if (Array.isArray(body.menu)) {
    // BEGIN/COMMIT ile sarilir - agent-ws.js:replaceCourierData'da canli tespit
    // edilen "DELETE ile INSERT arasinda ara an bos gorunuyor" hatasinin ayni
    // sinifi burada da olusabilirdi (musteri panelinden fiyat ararken).
    const insertItem = db.prepare(`
      INSERT INTO patron_menu_items (customer_id, price_id, item_id, portion_id, item_name, portion_name, tag_label, price, updated_at, group_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM patron_menu_items WHERE customer_id = ?').run(customer.id);
      for (const item of body.menu) {
        const priceId = Number(item && item.priceId);
        const itemId = Number(item && item.itemId);
        if (!Number.isInteger(priceId) || !Number.isInteger(itemId)) continue;
        insertItem.run(customer.id, priceId, itemId, Number(item.portionId) || 0,
          String(item.name || 'Bilinmeyen').slice(0, 200), String(item.portion || '').slice(0, 100),
          String(item.tagLabel || '').slice(0, 100), Number(item.price) || 0, now, String(item.group || '').slice(0, 100));
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  return { status: 200, body: { ok: true } };
}

/* Ajanlarin/kurulumlarin kendi kendine "lisansim aktif mi" diye sorabildigi,
   kimlik dogrulama gerektirmeyen (activation_key'in kendisi kimlik) salt-okunur uc.
   push()'un ayni activation_key + licenseActive() deseni - baska urun bayraklari
   (has_kurye/has_patron/has_qrmenu/has_gelismis_kurye) icin de genellenebilir olsun
   diye "product" parametresiyle hangi bayragin kontrol edilecegi disaridan secilir. */
const PRODUCT_COLUMNS = {
  kurye: 'has_kurye',
  patron: 'has_patron',
  qrmenu: 'has_qrmenu',
  gelismis_kurye: 'has_gelismis_kurye',
  garson: 'has_garson',
  ultra_paketci: 'has_ultra_paketci',
  kiosk: 'has_kiosk'
};
/* Urune gore hangi aktivasyon anahtari sutununa bakilacagi - Gelismis Kurye ve
   Garson Sistemi diger urunlerden AYRI kendi anahtarlarini kullanir. */
const PRODUCT_KEY_COLUMNS = {
  gelismis_kurye: 'gk_activation_key',
  garson: 'gs_activation_key',
  ultra_paketci: 'ultra_activation_key',
  kiosk: 'kiosk_activation_key'
};
function keyColumnFor(product) { return PRODUCT_KEY_COLUMNS[product] || 'activation_key'; }
/* "identifier" opsiyoneldir - verilirse musteri kaydindaki email/telefon ile
   eslesmesi de aranir. Kurulumlar arasi karisikligi onlemek icin (orn. Gelismis
   Kurye Sistemi restoran/admin girisinde SambaPOS PIN'ine ek olarak e-posta/
   telefon istenmesi) - "bu PIN dogru ama gercekten BU musteriye mi ait" sorusunu
   yanitlar. */
function identifierMatches(customer, identifier) {
  const value = String(identifier || '').trim().toLowerCase();
  if (!value) return true;
  const candidates = [customer.email, customer.phone, customer.business_name, customer.activation_key, customer.gk_activation_key, customer.gs_activation_key, customer.ultra_activation_key, customer.kiosk_activation_key]
    .map(v => String(v || '').trim().toLowerCase());
  return candidates.includes(value);
}
/* Gelismis Kurye Sistemi, diger 3 urunden AYRI bir aktivasyon anahtari kullanir
   (13.09.2026, canli bir karisiklik sonrasi) - o yuzden hangi sutuna gore aranacagi
   urune gore degisir, digerleri hala paylasilan activation_key'i kullanmaya devam eder. */
function licenseCheck(req, res, session, query) {
  const activationKey = String((query && query.get('key')) || '').trim();
  const product = String((query && query.get('product')) || '').trim();
  const identifier = (query && query.get('identifier')) || '';
  const column = PRODUCT_COLUMNS[product];
  const keyColumn = keyColumnFor(product);
  if (!activationKey) return { status: 400, body: { ok: false, error: 'key gerekli.' } };
  if (!column) return { status: 400, body: { ok: false, error: 'Geçersiz ürün.' } };
  const customer = db.prepare(`SELECT id, email, phone, business_name, activation_key, gk_activation_key, gs_activation_key, ultra_activation_key, kiosk_activation_key, subscription_status, license_expires_at, ${column} AS hasProduct FROM customers WHERE ${keyColumn} = ? AND deleted_at IS NULL`).get(activationKey);
  if (!customer) return { status: 200, body: { ok: false, error: 'Geçersiz aktivasyon anahtarı.' } };
  if (!licenseActive(customer)) return { status: 200, body: { ok: false, error: 'Abonelik aktif değil veya lisans süresi dolmuş.' } };
  if (!customer.hasProduct) return { status: 200, body: { ok: false, error: 'Bu ürün için lisansınız yok.' } };
  if (!identifierMatches(customer, identifier)) return { status: 200, body: { ok: false, error: 'E-posta/telefon kayıtlı bilgilerle eşleşmiyor.' } };
  return { status: 200, body: { ok: true } };
}

/* Gelismis Kurye Sistemi'nin "Bagli/Bagli degil" gostergesi icin - agent_status'tan
   AYRI bir tabloda (ayni musteride Kurye Bulut ajaniyla ayni satiri paylasip
   birbirinin last_seen_at'ini EZMESIN diye). Kimlik dogrulama gerektirmez,
   activation_key kimligin kendisidir - push()/licenseCheck ile ayni desen. */
/* product verilmezse (eski Gelismis Kurye kurulumlari) gelismis_kurye varsayilir -
   geriye donuk uyumluluk. Garson Sistemi ayri bir status tablosu kullanir (ayni
   musteride Gelismis Kurye ile ayni satiri paylasip birbirinin last_seen_at'ini
   EZMESIN diye - gelismis_kurye_status ile AYNI fikir). */
const HEARTBEAT_TABLES = { gelismis_kurye: 'gelismis_kurye_status', garson: 'garson_status', ultra_paketci: 'ultra_paketci_status', qrmenu: 'qrmenu_status' };
async function heartbeat(req, res) {
  const body = await auth.readJsonBody(req);
  const activationKey = String(body.activationKey || '').trim();
  const product = String(body.product || 'gelismis_kurye').trim();
  const table = HEARTBEAT_TABLES[product];
  if (!activationKey) return { status: 400, body: { error: 'activationKey gerekli.' } };
  if (!table) return { status: 400, body: { error: 'Geçersiz ürün.' } };
  const keyColumn = keyColumnFor(product);
  const customer = db.prepare(`SELECT id FROM customers WHERE ${keyColumn} = ? AND deleted_at IS NULL`).get(activationKey);
  if (!customer) return { status: 403, body: { error: 'Geçersiz aktivasyon anahtarı.' } };
  db.prepare(`
    INSERT INTO ${table} (customer_id, last_seen_at) VALUES (?, ?)
    ON CONFLICT(customer_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(customer.id, Date.now());
  return { status: 200, body: { ok: true } };
}

/* Gelismis Kurye Sistemi restoran/admin girisinin 1. adimi: musterinin GERCEK bulut
   panel sifresini (customers.password_hash - musteri/bayi panelinde kullandigi ayni
   sifre) dogrular. Onceki tasarimda sadece e-posta/telefon EŞLEŞMESİNE bakiliyordu,
   sifre hic kontrol edilmiyordu - 13.09.2026'da, "once e-posta+sifre, sonra SambaPOS
   PIN'i" iki adimli akisa gecilirken duzeltildi. */
/* gkKey (eski Gelismis Kurye istemcileri) VEYA key+product (Garson Sistemi ve
   sonraki urunler) kabul edilir - genellestirildi, YENI bir uc yazilmadi. */
async function verifyPassword(req, res) {
  const body = await auth.readJsonBody(req);
  const product = String(body.product || (body.gkKey ? 'gelismis_kurye' : '')).trim() || 'gelismis_kurye';
  const key = String(body.key || body.gkKey || '').trim();
  const identifier = String(body.identifier || '').trim();
  const password = String(body.password || '');
  const column = PRODUCT_COLUMNS[product];
  const keyColumn = keyColumnFor(product);
  if (!key || !identifier || !password) return { status: 400, body: { ok: false, error: 'Eksik bilgi.' } };
  if (!column) return { status: 400, body: { ok: false, error: 'Geçersiz ürün.' } };
  const customer = db.prepare(`SELECT id, email, phone, business_name, activation_key, gk_activation_key, gs_activation_key, ultra_activation_key, subscription_status, license_expires_at, ${column} AS hasProduct, password_salt, password_hash FROM customers WHERE ${keyColumn} = ? AND deleted_at IS NULL`).get(key);
  if (!customer) return { status: 200, body: { ok: false, error: 'Geçersiz aktivasyon anahtarı.' } };
  if (!licenseActive(customer) || !customer.hasProduct) return { status: 200, body: { ok: false, error: 'Lisans aktif değil.' } };
  if (!identifierMatches(customer, identifier)) return { status: 200, body: { ok: false, error: 'E-posta/telefon kayıtlı bilgilerle eşleşmiyor.' } };
  if (!customer.password_hash || !auth.checkPassword(password, customer.password_salt, customer.password_hash)) {
    return { status: 200, body: { ok: false, error: 'Şifre hatalı.' } };
  }
  return { status: 200, body: { ok: true } };
}

/* QR Menü - restoran sahibinin kendi kisa/hatirlanabilir baglanti adini
   (customers.qrmenu_slug) kendi admin panelinden degistirebilmesi icin
   (26.09.2026, kullanici bulgusu: "otomatik uretilen slug (orn. sp62yd) cok
   uzun/anlamsiz, TV uzaktan kumandasiyla elle yazmasi zor"). qrmenu-tunnel.js
   ayni sutunu ilk baglantida otomatik doldurur (ensureSlug) - burasi SADECE
   musteri kendi isteğiyle DEGISTIRMEK istediginde kullanilir, baska hicbir
   urunde slug kavramı yok. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'www', 'garson', 'tv', 'siparis', 'menu', 'qrmenu', 'select', 'app']);
async function setQrmenuSlug(req, res) {
  const body = await auth.readJsonBody(req);
  const key = String(body.key || '').trim();
  const slug = String(body.slug || '').trim().toLowerCase();
  if (!key || !slug) return { status: 400, body: { ok: false, error: 'Eksik bilgi.' } };
  if (slug.length < 3 || slug.length > 30 || !SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    return { status: 200, body: { ok: false, error: 'Bağlantı adı 3-30 karakter olmalı, sadece küçük harf/rakam/tire (-) içerebilir ve "admin", "tv" gibi ayrılmış kelimeler olmamalı.' } };
  }
  const customer = db.prepare('SELECT id, subscription_status, license_expires_at, has_qrmenu FROM customers WHERE activation_key = ? AND deleted_at IS NULL').get(key);
  if (!customer) return { status: 200, body: { ok: false, error: 'Geçersiz aktivasyon anahtarı.' } };
  if (!licenseActive(customer) || !customer.has_qrmenu) return { status: 200, body: { ok: false, error: 'Lisans aktif değil.' } };
  const taken = db.prepare('SELECT 1 FROM customers WHERE qrmenu_slug = ? AND id != ? AND deleted_at IS NULL').get(slug, customer.id);
  if (taken) return { status: 200, body: { ok: false, error: 'Bu bağlantı adı başka bir işletme tarafından kullanılıyor.' } };
  db.prepare('UPDATE customers SET qrmenu_slug = ? WHERE id = ?').run(slug, customer.id);
  return { status: 200, body: { ok: true, slug } };
}

/* Gelismis Kurye/Ultra Paketci "Musteri Takip Linki" (28.09.2026) - restoran
   bilgisayarindaki uygulama, musteriye ELLE gonderilecek bir takip token'i
   URETTIGI an burayi haberdar eder ki gk-web.js/ultra-web.js o token icin
   "hangi restoransiniz" secim cerezini ATLAYIP dogrudan doGru tunele
   yonlendirebilsin (bkz. db.js courier_order_tracking, routes/gk-web.js). */
async function registerTrackingToken(req, res) {
  const body = await auth.readJsonBody(req);
  const product = String(body.product || 'gelismis_kurye').trim();
  const key = String(body.key || '').trim();
  const token = String(body.token || '').trim();
  const column = PRODUCT_COLUMNS[product];
  const keyColumn = keyColumnFor(product);
  if (!key || !token) return { status: 400, body: { ok: false, error: 'Eksik bilgi.' } };
  if (!column) return { status: 400, body: { ok: false, error: 'Geçersiz ürün.' } };
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) return { status: 400, body: { ok: false, error: 'Geçersiz token.' } };
  const customer = db.prepare(`SELECT id, subscription_status, license_expires_at, ${column} AS hasProduct FROM customers WHERE ${keyColumn} = ? AND deleted_at IS NULL`).get(key);
  if (!customer) return { status: 200, body: { ok: false, error: 'Geçersiz aktivasyon anahtarı.' } };
  if (!licenseActive(customer) || !customer.hasProduct) return { status: 200, body: { ok: false, error: 'Lisans aktif değil.' } };
  db.prepare(`INSERT INTO courier_order_tracking (token, customer_id, product) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET customer_id = excluded.customer_id, product = excluded.product`)
    .run(token, customer.id, product);
  return { status: 200, body: { ok: true } };
}

module.exports = [
  { method: 'POST', path: '/api/agent/push', handler: push },
  { method: 'POST', path: '/api/agent/register-tracking-token', handler: registerTrackingToken },
  { method: 'GET', path: '/api/agent/license-check', handler: licenseCheck },
  { method: 'POST', path: '/api/agent/heartbeat', handler: heartbeat },
  { method: 'POST', path: '/api/agent/verify-password', handler: verifyPassword },
  { method: 'POST', path: '/api/agent/qrmenu-set-slug', handler: setQrmenuSlug }
];
