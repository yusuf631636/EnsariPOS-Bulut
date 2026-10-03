/* QR Menü icin: restoran bilgisayarindaki alfapos-qrmenu-yerel uygulamasina
   GENEL AMACLI ters HTTP tuneli (qrmenu-tunnel.js) uzerinden erisim.
   C:\toplu\routes\gk-web.js ile AYNI iskelet, AMA IKI MODLU (gk-web.js'te
   tek mod vardi - QR Menü'nün kendine ozgu ihtiyaci: musteri QR kodu
   okutunca "hangi restoransiniz" formuyla KARSILASMAMALI):

   1) SLUG MODU (menu.ornek-alanadi.com/<slug>/...) - HERKESE ACIK, cerez/secim
      YOK. Slug dogrudan customers.qrmenu_slug'dan customerId'ye cozulur,
      istek o musterinin tuneline yonlendirilir. Masalara konan QR kodu bu
      adresi (menu.ornek-alanadi.com/<slug>/) hedefler.
   2) SECIM MODU (app.ornek-alanadi.com/qrmenu/...) - restoran SAHIBI icin: GK/Ultra
      ile AYNI "isletme adi/e-posta/telefon/aktivasyon anahtari" formu + cerez
      (qrmenu_tenant, 12 saat). GERCEK kimlik dogrulama (sifre + SambaPOS PIN)
      bu adimdan SONRA, tunellenen istegin ICINDE, alfapos-qrmenu-yerel'in
      KENDI server.js'i tarafindan yapilir - bulut sifre/PIN'i hic gormez. */
const crypto = require('crypto');
const { db } = require('../db');
const { sendTunneledRequest, isConnected, findCustomerBySlug, findCustomerByIdentifier, licenseActive } = require('./qrmenu-tunnel');
const qrCache = require('./qrmenu-cache');

function parseCookies(req) {
  const header = req.headers.cookie, out = {};
  if (!header) return out;
  header.split(';').forEach(part => { const i = part.indexOf('='); if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); });
  return out;
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 5e6) req.destroy(new Error('İstek çok büyük.')); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const TENANT_COOKIE = 'qrmenu_tenant';
const TENANT_TTL_MS = 12 * 60 * 60 * 1000;
const tenantSessions = new Map(); // token -> { customerId, expires }

function findTenant(req) {
  const token = parseCookies(req)[TENANT_COOKIE];
  if (!token) return null;
  const entry = tenantSessions.get(token);
  if (!entry) return null;
  if (entry.expires < Date.now()) { tenantSessions.delete(token); return null; }
  return entry.customerId;
}

const PAGE_STYLE = `body{margin:0;background:#0b0d10;color:#f3f5f7;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
.card{width:min(380px,100%);background:#161a1e;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:28px 22px}
h1{margin:0 0 6px;font-size:19px}p{color:#8b939a;font-size:13px;margin:0 0 18px}
input{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:#1f2429;color:#f3f5f7;font:inherit;margin-bottom:12px}
button{width:100%;padding:13px;border-radius:10px;border:0;background:#4c8cf0;color:#06121f;font-weight:700;font-size:15px;cursor:pointer}
.err{color:#ff9aa3;background:rgba(239,74,88,.13);border:1px solid rgba(239,74,88,.35);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:14px}`;

function selectPage(error) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR Menü</title><style>${PAGE_STYLE}</style></head><body>
  <div class="card">
    <h1>QR Menü</h1>
    <p>Hangi restoran olduğunuzu belirtin - işletme adı, e-posta, telefon veya aktivasyon anahtarınız.</p>
    ${error ? `<div class="err">${error}</div>` : ''}
    <form method="POST" action="/qrmenu/select">
      <input name="identifier" placeholder="İşletme adı / e-posta / telefon / anahtar" required autofocus>
      <button type="submit">Devam Et</button>
    </form>
  </div></body></html>`;
}
/* 30.09.2026: eskiden 502 ile gonderiliyordu - Cloudflare 502/504'u KENDI "Hatali ag gecidi"
   sayfasiyla degistirdigi icin bu aciklama kullaniciya HIC ulasmiyordu (kullanici bulgusu:
   telefondan "502"). Artik 200 ile gonderilir; secim modunda hangi isletmenin secili oldugu
   ve "Baska isletme sec" dugmesi gosterilir (yanlis isletme 12 saat cerezde kaliyordu). */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function notConnectedPage(opts) {
  const o = opts || {};
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR Menü</title><style>${PAGE_STYLE}
  .alt{display:block;text-align:center;margin-top:12px;color:#8fb6ff;font-size:14px;text-decoration:none}</style></head><body>
  <div class="card">
    <h1>${o.timeout ? 'Yanıt gelmedi' : 'Restoran bilgisayarına ulaşılamıyor'}</h1>
    ${o.name ? `<p>Seçili işletme: <b style="color:#f3f5f7">${esc(o.name)}</b></p>` : ''}
    <p>${o.timeout ? 'Restoran bilgisayarı yanıt vermedi (bağlantı zaman aşımına uğradı).' : (o.picker ? 'Bu işletmenin QR Menü programı şu an buluta bağlı değil: bilgisayar kapalı olabilir ya da internet kesik olabilir.' : 'Menü şu an açılamıyor. Lütfen birkaç dakika sonra tekrar deneyin.')} ${o.picker ? 'Yanlış işletmeyi seçtiyseniz aşağıdan değiştirin.' : ''}</p>
    <form method="GET" action=""><button type="submit">Tekrar Dene</button></form>
    ${o.picker ? '<a class="alt" href="/qrmenu/logout">↺ Başka işletme seç</a>' : ''}
  </div></body></html>`;
}

/* Bir tunellenen istegi calistirip cevabi gercek res'e yazar - hem slug hem
   secim modu bunu kullanir, SADECE customerId ve forwardPath farkli. */
async function proxyToCustomer(req, res, u, customerId, forwardPath, picker) {
  const bodyBuf = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readRawBody(req);
  const headers = { ...req.headers };
  delete headers.host; delete headers.connection; delete headers['content-length'];

  /* gk-web.js'teki AYNI gerekce: tunel WS baglantisi periyodik olarak kisa
     sureligine kopup yeniden baglanabilir - TEK SEFERLIK kisa bir
     bekle-yeniden-dene ekleniyor ki bu dar pencereye denk gelen istekler
     kullaniciya hic hata gostermeden sessizce basarili olsun. */
  async function attempt() {
    if (!isConnected(customerId)) throw new Error('NOT_CONNECTED');
    return sendTunneledRequest(customerId, { method: req.method, path: forwardPath, headers, bodyBase64: bodyBuf.toString('base64') });
  }
  let tunneled, finalError;
  try {
    tunneled = await attempt();
  } catch (firstError) {
    if (firstError.message === 'NOT_CONNECTED') await new Promise(r => setTimeout(r, 1500));
    try { tunneled = await attempt(); } catch (secondError) { finalError = secondError; }
  }
  if (finalError) {
    /* 02.10.2026: musteri menusu bilgisayar kapaliyken buluttaki kopyadan acilir (qrmenu-cache.js);
       siparis/garson cagirma alinamaz. Yonetim paneli (picker) icin kopya yok. */
    if (!picker) {
      const p = forwardPath.split('?')[0].toLowerCase();
      if (req.method !== 'GET' && /^\/api\/(order|waiter-call)\b/.test(p)) {
        return json(res, 503, { error: 'Restoran şu an çevrimiçi değil, sipariş alınamıyor. Lütfen siparişinizi garsona ya da telefonla iletin.' });
      }
      if (req.method === 'GET' && p === '/api/table-status') return json(res, 200, { items: [], total: 0, offline: true });
      const hit = req.method === 'GET' && qrCache.cacheable('GET', forwardPath) ? qrCache.get(customerId, forwardPath) : null;
      if (hit) {
        const isHtml = /text\/html/i.test(hit.type);
        res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'no-store', 'X-QR-Offline': '1' });
        return res.end(isHtml ? qrCache.offlineBanner(hit.body, qrCache.lastSaved(customerId)) : hit.body);
      }
    }
    const isApi = u.pathname.includes('/api/');
    const message = finalError.message === 'TIMEOUT'
      ? 'Restoran bilgisayarından yanıt gelmedi (bağlantı zaman aşımına uğradı). Tekrar deneyin.'
      : 'Restoran bilgisayarının QR Menü uygulaması şu an bulut bağlantısı kurmamış.';
    /* 502/504 Cloudflare tarafindan kendi hata sayfasiyla degistirilir - API 503, sayfa 200 */
    if (isApi) return json(res, 503, { error: message });
    let name = '';
    if (picker) { try { const row = db.prepare('SELECT business_name FROM customers WHERE id = ?').get(customerId); name = row ? row.business_name : ''; } catch { /* onemsiz */ } }
    return html(res, 200, notConnectedPage({ timeout: finalError.message === 'TIMEOUT', picker: !!picker, name }));
  }
  const outHeaders = { ...(tunneled.headers || {}) };
  delete outHeaders['content-length'];
  const outBody = Buffer.from(tunneled.bodyBase64 || '', 'base64');
  if (!picker) qrCache.put(customerId, req.method, forwardPath, tunneled.status || 200, tunneled.headers, outBody);
  res.writeHead(tunneled.status || 200, outHeaders);
  res.end(outBody);
}

/* SLUG MODU - menu.ornek-alanadi.com/<slug>/... . Cerez/secim YOK, herkese acik. */
async function handleSlug(req, res, u) {
  try {
    const segments = u.pathname.replace(/^\/+/, '').split('/');
    const slug = segments.shift() || '';
    if (!slug) return html(res, 404, '<p>Menü bulunamadı.</p>');
    const customer = findCustomerBySlug(slug);
    if (!customer || !licenseActive(customer) || !customer.has_qrmenu) return html(res, 404, '<p>Menü bulunamadı.</p>');
    const restOfPath = '/' + segments.join('/');
    /* GUVENLIK/NETLIK (20.09.2026, kullanici bulgusu: "admin panel indeksinin
       ne isi var orada") - yonetim paneli SAYFASI (admin/index.html) SADECE
       app.ornek-alanadi.com/qrmenu (aktivasyon anahtariyla secim + sifre + PIN)
       uzerinden erisilmeli; herkese acik musteri menu linkinden bu SAYFA
       acilmamali - kafa karistirici bir giris noktasi.
       ONEMLI DUZELTME (ayni gun, kullanici bulgusu: "garson pin'de istek
       basarisiz diyor") - ONCEKI surum /api/admin/* UCLARINI DA burada
       engelliyordu, ama garson.html (KASITLI olarak slug linkinden erisilebilir
       birakildi, /admin gibi ENGELLENMEDI) TUM islevi icin /api/admin/garson-login,
       /api/admin/orders, /api/admin/waiter-calls, /api/admin/events GIBI
       uclara ihtiyac duyuyor - hepsi zaten KENDI PIN/oturum kontrolunu yapiyor,
       ayrica burada engellemeye GEREK YOK, sadece gercek /admin SAYFASINI
       (login formunu gosteren HTML) engellemek yeterli. */
    if (restOfPath === '/admin' || restOfPath.startsWith('/admin/')) {
      return html(res, 404, '<p>Menü bulunamadı.</p>');
    }
    const forwardPath = restOfPath + u.search;
    return await proxyToCustomer(req, res, u, customer.id, forwardPath);
  } catch (error) {
    html(res, 500, `<p>Beklenmeyen hata: ${error.message}</p>`);
  }
}

async function handleSelect(req, res) {
  const bodyBuf = await readRawBody(req);
  const params = new URLSearchParams(bodyBuf.toString('utf8'));
  const identifier = String(params.get('identifier') || '').trim();
  if (!identifier) return html(res, 400, selectPage('İşletme bilgisi girin.'));
  const customer = findCustomerByIdentifier(identifier);
  if (!customer || !licenseActive(customer)) return html(res, 401, selectPage('İşletme bulunamadı veya QR Menü lisansı aktif değil.'));
  /* Tunel WS baglantisi periyodik olarak kisa sureligine kopup yeniden
     baglanabilir (proxyToCustomer'daki AYNI gerekce) - TAM o dar pencereye
     denk gelen bir "isletme sec" denemesi gercekte baglanti calisiyorken bile
     "Baglanti yok" gorebilirdi. Burada da AYNI tek seferlik bekle-yeniden-dene
     uygulanir. */
  if (!isConnected(customer.id)) {
    await new Promise(r => setTimeout(r, 1500));
    if (!isConnected(customer.id)) {
      let name = ''; try { const row = db.prepare('SELECT business_name FROM customers WHERE id = ?').get(customer.id); name = row ? row.business_name : ''; } catch { /* onemsiz */ }
      return html(res, 200, notConnectedPage({ picker: true, name }));
    }
  }

  const token = crypto.randomBytes(24).toString('hex');
  tenantSessions.set(token, { customerId: customer.id, expires: Date.now() + TENANT_TTL_MS });
  res.writeHead(302, {
    'Set-Cookie': `${TENANT_COOKIE}=${token}; Path=/qrmenu; HttpOnly; SameSite=Lax; Secure; Max-Age=${Math.floor(TENANT_TTL_MS / 1000)}`,
    'Location': '/qrmenu/admin'
  });
  res.end();
}

/* SECIM MODU - app.ornek-alanadi.com/qrmenu/... (restoran sahibinin giris noktasi). */
async function handlePicker(req, res, u) {
  try {
    const rel = u.pathname.replace(/^\/qrmenu/, '') || '/';
    if (rel === '/select' && req.method === 'POST') return await handleSelect(req, res);
    /* "Uygulama olarak yukle" dosyalari (30.09.2026): Chrome manifest'i ve ikonlari CEREZSIZ ister -
       cerez olmayinca isletme secim sayfasi donuyor, yukleme reddediliyordu. Bunlar her restoran
       icin AYNI oldugundan bulut kendisi verir (restorana tunel gerekmez). */
    if (rel === '/admin/admin-manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(JSON.stringify({ name: 'QR Menü Yönetim Paneli', short_name: 'QR Yönetim', description: 'Siparişler, menü, TV ve kiosk yönetimi',
        id: '/qrmenu/admin/', start_url: '/qrmenu/admin/', scope: '/qrmenu/', display: 'standalone', orientation: 'portrait',
        background_color: '#141c30', theme_color: '#141c30',
        icons: [{ src: '/qrmenu/admin/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/qrmenu/admin/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/qrmenu/admin/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }));
    }
    if (rel === '/admin/icon-192.png' || rel === '/admin/icon-512.png') {
      const icons = require('./admin-icons');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(icons[rel.includes('512') ? 512 : 192]);
    }
    if (rel === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));" +
        "self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});");
    }
    if (rel === '/logout') {
      res.writeHead(302, { 'Set-Cookie': `${TENANT_COOKIE}=; Path=/qrmenu; Max-Age=0`, 'Location': '/qrmenu' });
      return res.end();
    }
    const customerId = findTenant(req);
    if (!customerId) return html(res, 200, selectPage());
    /* admin/index.html kendi API_BASE'ini tarayici adres cubugundaki
       location.pathname'den hesapliyor - adres cubugu "/qrmenu/admin" DEGIL
       de sadece "/qrmenu" veya "/qrmenu/" olarak kalirsa (asagidaki gibi
       direkt proxy'lenirse, YONLENDIRME olmadan) o hesaplama kirilgan hale
       geliyordu (25.09.2026, kullanici bulgusu: "bulunamadı diyor"). Adres
       cubugunun HER ZAMAN acikca "/qrmenu/admin" olmasini garanti etmek icin
       "/" ve "/qrmenu" istekleri BURADA yonlendirilir - proxy'lenmez. */
    if ((rel === '/' || rel === '') && req.method === 'GET') {
      res.writeHead(302, { Location: '/qrmenu/admin' });
      return res.end();
    }
    const forwardPath = (rel === '/' ? '/admin' : rel) + u.search;
    return await proxyToCustomer(req, res, u, customerId, forwardPath, true);
  } catch (error) {
    html(res, 500, `<p>Beklenmeyen hata: ${error.message}</p>`);
  }
}

module.exports = { handleSlug, handlePicker };
