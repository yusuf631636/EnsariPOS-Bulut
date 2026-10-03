/* ultra.ornek-alanadi.com icin: Ultra Paketci'nin restoran bilgisayarindaki uygulamasina
   GENEL AMACLI ters HTTP tuneli (ultra-tunnel.js) uzerinden erisim. server.js bu
   modulu SADECE "Host: ultra.ornek-alanadi.com" geldiginde cagirir - baska hicbir
   host/path bundan etkilenmez.

   gk-web.js (Gelismis Kurye Sistemi, kuryeler.ornek-alanadi.com) ile AYNI iskelet -
   KASITLI OLARAK bagimsiz bir kopya, gk-web.js'e HICBIR SEKILDE dokunulmadan
   yanina eklendi (15.09.2026, "ultra.ornek-alanadi.com Gelismis Kurye Sistemi'nin
   verisini gosteriyor" sorunu tunel karisikligindan cozulurken). TEK GERCEK FARK:
   bu dosya KENDI aktivasyon anahtarini (ultra_activation_key/has_ultra_paketci)
   ve KENDI tunelini (ultra-tunnel.js, /ultra-tunnel yolu) kullanir - Gelismis
   Kurye Sistemi'nin gk_activation_key/gk-tunnel.js'ine hic dokunmaz, ayni
   restoranda ikisi asla birbirinin yerini alamaz. Statik dosyalar (manifest/
   ikon/sw.js) da HER ZAMAN Ultra Paketci markali public/gk-ultra'dan gelir -
   host'a gore secim YAPILMAZ, bu dosya zaten SADECE ultra.ornek-alanadi.com icin
   cagrilir. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { sendTunneledRequest, isConnected } = require('./ultra-tunnel');
const { licenseActive } = require('../lib/license');

const STATIC_ULTRA_ROOT = path.join(__dirname, '..', 'public', 'gk-ultra');
const STATIC_ULTRA_FILES = {
  '/courier/manifest.webmanifest': { file: 'courier/manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/courier/sw.js': { file: 'courier/sw.js', type: 'application/javascript; charset=utf-8' },
  '/courier/icons/icon-192.png': { file: 'courier/icons/icon-192.png', type: 'image/png' },
  '/courier/icons/icon-512.png': { file: 'courier/icons/icon-512.png', type: 'image/png' },
  '/restoran/manifest.webmanifest': { file: 'restoran/manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/restoran/sw.js': { file: 'restoran/sw.js', type: 'application/javascript; charset=utf-8' },
  '/restoran/icons/icon-192.png': { file: 'restoran/icons/icon-192.png', type: 'image/png' },
  '/restoran/icons/icon-512.png': { file: 'restoran/icons/icon-512.png', type: 'image/png' },
};
function serveStaticUltraAsset(res, pathname) {
  const entry = STATIC_ULTRA_FILES[pathname];
  if (!entry) return false;
  try {
    const data = fs.readFileSync(path.join(STATIC_ULTRA_ROOT, entry.file));
    res.writeHead(200, { 'Content-Type': entry.type, 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
  return true;
}

const TENANT_COOKIE = 'ultra_tenant';
const TENANT_TTL_MS = 12 * 60 * 60 * 1000;
const tenantSessions = new Map(); // token -> { customerId, expires }

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
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ultra Gelişmiş Kurye</title><style>${PAGE_STYLE}</style></head><body>
  <div class="card">
    <h1>Ultra Gelişmiş Kurye</h1>
    <p>Hangi restoran olduğunuzu belirtin - işletme adı, e-posta, telefon veya Ultra Gelişmiş Kurye aktivasyon anahtarınız.</p>
    ${error ? `<div class="err">${error}</div>` : ''}
    <form method="POST" action="/select">
      <input name="identifier" placeholder="İşletme adı / e-posta / telefon / anahtar" required autofocus>
      <button type="submit">Devam Et</button>
    </form>
  </div></body></html>`;
}
function notConnectedPage() {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ultra Gelişmiş Kurye</title><style>${PAGE_STYLE}</style></head><body>
  <div class="card">
    <h1>Bağlantı yok</h1>
    <p>Bu restoranın Ultra Gelişmiş Kurye'si şu an bulut bağlantısı kurmamış (bilgisayar kapalı olabilir, program kapatılmış olabilir). Restoran bilgisayarından kontrol edin, birkaç saniye sonra tekrar deneyin.</p>
    <form method="GET" action="/"><button type="submit">Tekrar Dene</button></form>
  </div></body></html>`;
}

async function handleSelect(req, res) {
  const bodyBuf = await readRawBody(req);
  const params = new URLSearchParams(bodyBuf.toString('utf8'));
  const identifier = String(params.get('identifier') || '').trim();
  if (!identifier) return html(res, 400, selectPage('İşletme bilgisi girin.'));
  const value = identifier.toLowerCase();
  const customer = db.prepare(`
    SELECT id, subscription_status, license_expires_at, has_ultra_paketci
    FROM customers
    WHERE deleted_at IS NULL AND has_ultra_paketci = 1
      AND (LOWER(ultra_activation_key) = ? OR LOWER(business_name) = ? OR LOWER(email) = ? OR LOWER(phone) = ?)
  `).get(value, value, value, value);
  if (!customer || !licenseActive(customer)) return html(res, 401, selectPage('İşletme bulunamadı veya Ultra Gelişmiş Kurye lisansı aktif değil.'));
  if (!isConnected(customer.id)) return html(res, 200, notConnectedPage());

  const token = crypto.randomBytes(24).toString('hex');
  tenantSessions.set(token, { customerId: customer.id, expires: Date.now() + TENANT_TTL_MS });
  res.writeHead(302, {
    'Set-Cookie': `${TENANT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${Math.floor(TENANT_TTL_MS / 1000)}`,
    'Location': '/courier'
  });
  res.end();
}

/* Ana giris noktasi - server.js'in "Host: ultra.ornek-alanadi.com" kontrolunden
   cagrilir. Kendi route/serveStatic mekanizmasinin TAMAMEN disindadir. */
async function handle(req, res, u) {
  try {
    if (req.method === 'GET' && serveStaticUltraAsset(res, u.pathname)) return;
    if (u.pathname === '/select' && req.method === 'POST') return await handleSelect(req, res);
    if (u.pathname === '/' && req.method === 'GET' && !findTenant(req)) return html(res, 200, selectPage());
    if (u.pathname === '/gk-logout') {
      res.writeHead(302, { 'Set-Cookie': `${TENANT_COOKIE}=; Path=/; Max-Age=0`, 'Location': '/' });
      return res.end();
    }

    const customerId = findTenant(req);
    if (!customerId) return html(res, 200, selectPage());

    const bodyBuf = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readRawBody(req);
    const path = u.pathname + u.search;
    const headers = { ...req.headers };
    delete headers.host; delete headers.connection; delete headers['content-length'];

    async function attempt() {
      if (!isConnected(customerId)) throw new Error('NOT_CONNECTED');
      return sendTunneledRequest(customerId, { method: req.method, path, headers, bodyBase64: bodyBuf.toString('base64') });
    }
    let tunneled, finalError;
    try {
      tunneled = await attempt();
    } catch (firstError) {
      if (firstError.message === 'NOT_CONNECTED') await new Promise(r => setTimeout(r, 1500));
      try {
        tunneled = await attempt();
      } catch (secondError) {
        finalError = secondError;
      }
    }
    if (finalError) {
      const isApi = u.pathname.startsWith('/api/');
      const message = finalError.message === 'TIMEOUT'
        ? 'Restoran bilgisayarından yanıt gelmedi (bağlantı zaman aşımına uğradı). Tekrar deneyin.'
        : 'Restoran bilgisayarının Ultra Gelişmiş Kurye\'si şu an bulut bağlantısı kurmamış.';
      if (isApi) return json(res, 502, { error: message });
      if (finalError.message === 'TIMEOUT') return html(res, 504, `<p>${message}</p>`);
      return html(res, 502, notConnectedPage());
    }
    const outHeaders = { ...(tunneled.headers || {}) };
    delete outHeaders['content-length'];
    res.writeHead(tunneled.status || 200, outHeaders);
    res.end(Buffer.from(tunneled.bodyBase64 || '', 'base64'));
  } catch (error) {
    html(res, 500, `<p>Beklenmeyen hata: ${error.message}</p>`);
  }
}

module.exports = { handle };
