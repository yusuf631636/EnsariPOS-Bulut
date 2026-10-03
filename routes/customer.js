const { db } = require('../db');
const auth = require('../auth');
const patronWs = require('../Patron/patron-ws');

/* Ilk giris akisi: admin bir musteri olusturunca password_hash NULL kalir.
   Restoran sahibi aktivasyon anahtariyla kendi sifresini burada belirler. */
async function activate(req, res) {
  const body = await auth.readJsonBody(req);
  const key = String(body.activationKey || '').trim();
  const password = String(body.password || '');
  if (password.length < 4) return { status: 400, body: { error: 'Şifre en az 4 karakter olmalı.' } };
  const row = db.prepare('SELECT id, password_hash FROM customers WHERE activation_key = ? AND deleted_at IS NULL').get(key);
  if (!row) return { status: 404, body: { error: 'Aktivasyon anahtarı bulunamadı.' } };
  if (row.password_hash) return { status: 409, body: { error: 'Bu hesap zaten aktifleştirilmiş. Giriş ekranını kullanın.' } };
  const cred = auth.makeCredential(password);
  db.prepare('UPDATE customers SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, row.id);
  return { status: 200, body: { ok: true } };
}

function summary(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const customer = db.prepare('SELECT business_name, subscription_status, license_expires_at FROM customers WHERE id = ?').get(session.id);
  const row = db.prepare('SELECT payload, updated_at FROM customer_snapshots WHERE customer_id = ?').get(session.id);
  let licenseOk = false; try { licenseOk = !!(customer && require('../lib/license').licenseActive(customer)); } catch { /* yok */ }
  return {
    status: 200,
    body: {
      businessName: customer ? customer.business_name : '',
      // 02.10.2026: Patron ana sayfasindaki kasa kartinda lisans durumu / bitis tarihi
      license: customer ? { active: licenseOk, expiresAt: customer.license_expires_at || null } : null,
      updatedAt: row ? row.updated_at : null,
      data: row ? JSON.parse(row.payload) : null
    }
  };
}

/* Su anki aktif siparislerden (courier_orders) bekleyen/yolda sayilari +
   courier_pins'ten telefon - kurye takip'in kendi admin panelindeki
   "Kuryeler" sekmesinin bulut karsiligi. */
function couriers(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const pins = db.prepare('SELECT courier_name, pin, phone FROM courier_pins WHERE customer_id = ? ORDER BY courier_name').all(session.id);
  const orders = db.prepare('SELECT courier_name, package_status FROM courier_orders WHERE customer_id = ?').all(session.id);
  const list = pins.map(p => {
    const own = orders.filter(o => o.courier_name === p.courier_name);
    return {
      name: p.courier_name,
      pin: p.pin,
      phone: p.phone || '',
      pending: own.filter(o => o.package_status !== 'Yolda').length,
      enroute: own.filter(o => o.package_status === 'Yolda').length
    };
  });
  return { status: 200, body: { couriers: list } };
}

async function setCourierPhone(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  if (!name) return { status: 400, body: { error: 'Kurye adı gerekli.' } };
  db.prepare('UPDATE courier_pins SET phone = ? WHERE customer_id = ? AND courier_name = ?').run(phone, session.id, name);
  return { status: 200, body: { ok: true } };
}

/* Gunun (yerel takvim gunu) sinirlarini epoch ms'e cevirir - delivery_events.at
   zaten epoch ms oldugu icin C:\kurye takip'te yasanan saat dilimi/string-yeniden-
   olusturma hatasina dusme riski yok. */
function dayRangeMs(day) {
  const start = new Date(`${day}T00:00:00`);
  return { start: start.getTime(), end: start.getTime() + 24 * 60 * 60 * 1000 };
}

function courierReport(req, res, session, query) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.get('date') || '') ? query.get('date') : new Date().toISOString().slice(0, 10);
  const { start, end } = dayRangeMs(day);
  const rows = db.prepare(`
    SELECT courier_name, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
    FROM delivery_events WHERE customer_id = ? AND event = 'delivered' AND at >= ? AND at < ?
    GROUP BY courier_name ORDER BY total DESC
  `).all(session.id, start, end);
  return { status: 200, body: { date: day, summary: rows } };
}

/* "Patron Raporu" sekmesindeki tarih araligi sorgusu - patron_daily_reports
   sadece BUGUNDEN itibaren birikir (agent.js:push() yorumuna bakin), o yuzden
   ondan onceki tarihler icin dogal olarak bos/eksik satirlar doner. */
function patronReport(req, res, session, query) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const today = new Date().toISOString().slice(0, 10);
  const isValidDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const start = isValidDate(query.get('start')) ? query.get('start') : today;
  const end = isValidDate(query.get('end')) ? query.get('end') : today;
  const rows = db.prepare(`
    SELECT report_date, sales, tickets, average, remaining
    FROM patron_daily_reports WHERE customer_id = ? AND report_date >= ? AND report_date <= ?
    ORDER BY report_date DESC
  `).all(session.id, start, end);
  const totals = rows.reduce((acc, r) => ({ sales: acc.sales + r.sales, tickets: acc.tickets + r.tickets, remaining: acc.remaining + r.remaining }), { sales: 0, tickets: 0, remaining: 0 });
  return { status: 200, body: { start, end, days: rows, totals } };
}

/* Fiyat guncelleme aramasi - patron_menu_items bulut aynasinda isme gore arar.
   Bos sorguda EN FAZLA 30 satir doner (tum menuyu bosuna cekmeyelim). */
function patronMenuSearch(req, res, session, query) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const q = String(query.get('q') || '').trim();
  /* 30.09.2026: kategori filtresi (group) + kategori listesi (groups) - yeni Patron panelinin "Menü" sekmesi.
     Kategori secilince o kategorinin TUM urunleri (en fazla 300) doner; eski arama davranisi (30 satir) aynen. */
  const group = query.has('group') ? String(query.get('group') || '') : null;
  let rows;
  if (group !== null) {
    rows = q
      ? db.prepare('SELECT price_id, item_name, portion_name, tag_label, price, group_name FROM patron_menu_items WHERE customer_id = ? AND group_name = ? AND item_name LIKE ? ORDER BY item_name, portion_name, tag_label LIMIT 300').all(session.id, group, `%${q}%`)
      : db.prepare('SELECT price_id, item_name, portion_name, tag_label, price, group_name FROM patron_menu_items WHERE customer_id = ? AND group_name = ? ORDER BY item_name, portion_name, tag_label LIMIT 300').all(session.id, group);
  } else {
    rows = q
      ? db.prepare('SELECT price_id, item_name, portion_name, tag_label, price, group_name FROM patron_menu_items WHERE customer_id = ? AND item_name LIKE ? ORDER BY item_name LIMIT 30').all(session.id, `%${q}%`)
      : db.prepare('SELECT price_id, item_name, portion_name, tag_label, price, group_name FROM patron_menu_items WHERE customer_id = ? ORDER BY item_name LIMIT 30').all(session.id);
  }
  const groups = db.prepare("SELECT group_name AS name, COUNT(DISTINCT item_id) AS count FROM patron_menu_items WHERE customer_id = ? AND group_name <> '' GROUP BY group_name ORDER BY group_name").all(session.id);
  const total = db.prepare('SELECT COUNT(DISTINCT item_id) AS n, MAX(updated_at) AS at FROM patron_menu_items WHERE customer_id = ?').get(session.id);
  return { status: 200, body: { items: rows, groups, itemCount: total ? total.n : 0, menuUpdatedAt: total ? total.at : null } };
}

/* 30.09.2026: Toplu zam/indirim - bir kategorideki (ya da tum menudeki) fiyatlara yuzde uygulanir.
   confirm yoksa SADECE onizleme doner (hicbir sey degismez). confirm:true ile degisen her fiyat icin mevcut
   'set-price' komutu kuyruga alinir - boylece eski (Node) ajanlar da uygular; restoran bilgisayari kapaliysa
   acilinca uygulanir. Yuvarlama: 0 (kurus), 0.5, 1, 5, 10 TL. */
function bulkPlan(customerId, body) {
  const group = String(body.group || '');
  const percent = Number(body.percent);
  const round = Number(body.round || 0);
  const tag = body.tag === undefined || body.tag === null ? '' : String(body.tag);
  if (!Number.isFinite(percent) || percent < -50 || percent > 200 || percent === 0) return { error: 'Yüzde -50 ile 200 arasında ve 0\'dan farklı olmalı.' };
  if (![0, 0.5, 1, 5, 10].includes(round)) return { error: 'Geçersiz yuvarlama.' };
  const rows = group === '*'
    ? db.prepare('SELECT price_id, item_name, portion_name, tag_label, price, group_name FROM patron_menu_items WHERE customer_id = ? ORDER BY group_name, item_name').all(customerId)
    : db.prepare('SELECT price_id, item_name, portion_name, tag_label, price, group_name FROM patron_menu_items WHERE customer_id = ? AND group_name = ? ORDER BY item_name').all(customerId, group);
  const changes = [];
  for (const r of rows) {
    if (tag && r.tag_label !== tag) continue;
    const old = Number(r.price) || 0;
    if (old <= 0) continue;
    let next = old * (1 + percent / 100);
    next = round > 0 ? Math.round(next / round) * round : Math.round(next * 100) / 100;
    next = Math.round(next * 100) / 100;
    if (next < 0 || next > 999999 || next === old) continue;
    changes.push({ priceId: r.price_id, name: r.item_name, portion: r.portion_name, tag: r.tag_label, group: r.group_name, oldPrice: old, newPrice: next });
  }
  return { changes, matched: rows.length };
}
async function patronBulkPrice(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const plan = bulkPlan(session.id, body);
  if (plan.error) return { status: 400, body: { error: plan.error } };
  if (!plan.changes.length) return { status: 200, body: { ok: true, preview: true, changes: [], matched: plan.matched } };
  if (plan.changes.length > 500) return { status: 400, body: { error: 'Tek seferde en fazla 500 fiyat değiştirilebilir, kategori seçin.' } };
  if (body.confirm !== true) return { status: 200, body: { ok: true, preview: true, changes: plan.changes, matched: plan.matched } };
  const ids = plan.changes.map(c => patronWs.sendPatronAction(session.id, 'set-price', { priceId: c.priceId, price: c.newPrice }));
  return { status: 200, body: { ok: true, preview: false, ids, count: ids.length, connected: patronWs.isConnected(session.id) } };
}
function patronBulkStatus(req, res, session, query) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const ids = String(query.get('ids') || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500);
  if (!ids.length) return { status: 400, body: { error: 'ids gerekli.' } };
  const rows = db.prepare(`SELECT id, done_at, result_json FROM patron_pending_actions WHERE customer_id = ? AND id IN (${ids.map(() => '?').join(',')})`).all(session.id, ...ids);
  let done = 0, failed = 0; const errors = [];
  for (const r of rows) {
    if (!r.done_at) continue;
    done++;
    let res2 = {}; try { res2 = JSON.parse(r.result_json || '{}'); } catch { /* bos */ }
    if (res2.ok === false) { failed++; if (errors.length < 5) errors.push(res2.error || 'hata'); }
  }
  return { status: 200, body: { total: ids.length, done, failed, errors } };
}

/* Fiyat degisikligi kuyruga alinir - bulut, restoranin SQL Server'ina ASLA
   dogrudan baglanmaz; C:\ensari\patron-cloud.js kendi tarafinda UPDATE'i
   calistirir. price_id'nin BU musteriye ait oldugu dogrulanir - baska bir
   kiracinin fiyat kaydi icin komut kuyruga alinamaz (qrmenu/kurye ile ayni ilke). */
async function patronSetPrice(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const priceId = Number(body.priceId);
  const raw = String(body.price !== undefined ? body.price : '').trim();
  if (!Number.isInteger(priceId) || priceId <= 0) return { status: 400, body: { error: 'Geçersiz ürün.' } };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { status: 400, body: { error: 'Geçersiz fiyat formatı.' } };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 999999) return { status: 400, body: { error: 'Fiyat 0 ile 999999 arasında olmalı.' } };
  const owns = db.prepare('SELECT 1 FROM patron_menu_items WHERE customer_id = ? AND price_id = ?').get(session.id, priceId);
  if (!owns) return { status: 404, body: { error: 'Bu ürün menünüzde bulunamadı.' } };
  const id = patronWs.sendPatronAction(session.id, 'set-price', { priceId, price: value });
  return { status: 200, body: { ok: true, id, connected: patronWs.isConnected(session.id) } };
}

/* Acik bir adisyonun icerigini (urun satirlari) ANLIK ister - kuyruklama/durum
   sorgulama deseni patronSetPrice/patronPriceStatus ile BIREBIR AYNI, sadece
   eylem adi ve dogrulama farkli (fiyat kaydi yerine hangi ticketId'nin
   istenecegi kontrol edilir - ama ticketId musteriye ozel bir tabloda
   ONCEDEN bilinmiyor, bu yuzden sahiplik kontrolu YAPILAMAZ; risk dusuk
   (sadece kendi restoran ajanina, sadece kendi customerId'siyle komut
   gonderilebiliyor, baska musterinin verisine erisim YOK). */
async function patronGetTicket(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const ticketId = Number(body.ticketId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) return { status: 400, body: { error: 'Geçersiz adisyon.' } };
  const id = patronWs.sendPatronAction(session.id, 'get-ticket-items', { ticketId });
  return { status: 200, body: { ok: true, id, connected: patronWs.isConnected(session.id) } };
}

/* "Saatlik Satis" sekmesinde tarih/saat araligi secilince - gunluk push
   SADECE bugunu tasidigi icin (bkz. customer_snapshots), gecmis tarih/saat
   sorgusu restoran bilgisayarindan CANLI istenir. Ayni kuyruklama/durum
   sorgulama deseni (patronGetTicket ile BIREBIR ayni), sadece eylem adi ve
   parametreler farkli. Restoranin kendi SQL Server'ina bulut ASLA dogrudan
   baglanmaz - sorgu her zaman C:\ensari\server.js'deki report() ile
   restoran bilgisayarinin KENDISINDE calisir. */
async function patronGetReport(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const body = await auth.readJsonBody(req);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const start = String(body.start || ''), end = String(body.end || '');
  if (!dateRe.test(start) || !dateRe.test(end) || start > end) return { status: 400, body: { error: 'Geçersiz tarih aralığı.' } };
  const hourGuard = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null; };
  const hourStart = hourGuard(body.hourStart), hourEnd = hourGuard(body.hourEnd);
  // extra:true (02.10.2026) - C# ajan 2.2+ ek kirilimlari (urun grubu, kullanici tahsilat, iskonto, ikram/iade, paketci) da doner
  const id = patronWs.sendPatronAction(session.id, 'get-report', { start, end, hourStart, hourEnd, extra: body.extra === true });
  return { status: 200, body: { ok: true, id, connected: patronWs.isConnected(session.id) } };
}

function patronPriceStatus(req, res, session, query) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const id = Number(query.get('id'));
  if (!id) return { status: 400, body: { error: 'id gerekli.' } };
  const row = db.prepare('SELECT done_at, result_json FROM patron_pending_actions WHERE id = ? AND customer_id = ?').get(id, session.id);
  if (!row) return { status: 404, body: { error: 'Komut bulunamadı.' } };
  if (!row.done_at) return { status: 200, body: { state: 'sirada' } };
  let result = {}; try { result = JSON.parse(row.result_json || '{}'); } catch { /* bos birak */ }
  return { status: 200, body: { state: result.ok === false ? 'hata' : 'uygulandi', ...result } };
}

/* "Genel" sekmesindeki aktif siparis listesi icin - kurye/kuryeler uzerinden
   toplanmis sayilardan farkli olarak her siparisin kendisini (musteri adi,
   fis no, tutar, durum) tek tek gosterir. */
function orders(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT ticket_id AS id, number, total, package_status AS packageStatus, courier_name AS courierName, customer_name AS customerName
    FROM courier_orders WHERE customer_id = ? ORDER BY ticket_id DESC
  `).all(session.id);
  return { status: 200, body: { orders: rows } };
}

/* Henuz hicbir kuryeye atanmamis, acik paket siparisleri - courier_orders'a
   dokunmayan, tamamen ayri bir tablodan okur. */
function unassignedOrders(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare(`
    SELECT ticket_id AS id, number, total, customer_name AS customerName, address, phone
    FROM unassigned_orders WHERE customer_id = ? ORDER BY ticket_id DESC
  `).all(session.id);
  return { status: 200, body: { orders: rows } };
}

function locations(req, res, session) {
  if (!auth.requireRole('customer')(req, res, session)) return { status: 401, body: { error: 'Oturum gerekli.' } };
  const rows = db.prepare('SELECT courier_name, lat, lng, accuracy, updated_at FROM courier_locations WHERE customer_id = ?').all(session.id);
  return { status: 200, body: { locations: rows } };
}

module.exports = [
  { method: 'POST', path: '/api/customer/activate', handler: activate },
  { method: 'GET', path: '/api/customer/summary', handler: summary },
  { method: 'GET', path: '/api/customer/couriers', handler: couriers },
  { method: 'POST', path: '/api/customer/courier-phone', handler: setCourierPhone },
  { method: 'GET', path: '/api/customer/courier-report', handler: courierReport },
  { method: 'GET', path: '/api/customer/patron-report', handler: patronReport },
  { method: 'GET', path: '/api/customer/patron-menu', handler: patronMenuSearch },
  { method: 'POST', path: '/api/customer/patron-price', handler: patronSetPrice },
  { method: 'POST', path: '/api/customer/patron-bulk-price', handler: patronBulkPrice },
  { method: 'GET', path: '/api/customer/patron-bulk-status', handler: patronBulkStatus },
  { method: 'GET', path: '/api/customer/patron-price-status', handler: patronPriceStatus },
  { method: 'POST', path: '/api/customer/patron-ticket', handler: patronGetTicket },
  { method: 'POST', path: '/api/customer/patron-hourly', handler: patronGetReport },
  { method: 'GET', path: '/api/customer/locations', handler: locations },
  { method: 'GET', path: '/api/customer/unassigned-orders', handler: unassignedOrders },
  { method: 'GET', path: '/api/customer/orders', handler: orders }
];
