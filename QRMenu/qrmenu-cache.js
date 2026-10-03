/* QR Menü bulut kopyasi (02.10.2026, kullanici: "pc kapaliyken girilmiyor").
   Musteri menusu (menu.ornek-alanadi.com/<slug>) restoran bilgisayarindan tunelle gelir; bilgisayar kapali/internet
   kesikken hic acilmiyordu. Burada her restoranin herkese acik menu sayfalari, menu verisi ve urun fotograflari
   diskte saklanir:
     - tunel bagliyken basarili her GET cevabi kaydedilir (pasif),
     - tunel baglaninca ve 30 dk'da bir ana sayfalar + menu API'leri + tum urun fotograflari cekilir (on yukleme),
     - tunel YOKKEN qrmenu-web.js GET isteklerini buradan verir (ustte "sipariş alınamıyor" seridi), siparis
       ve garson cagirma uclari 503 doner. Yonetim paneli (/api/admin, /admin) ve cerezli cevaplar ASLA
       kaydedilmez - kopya sadece herkese acik menu icindir.
   Dosyalar: data/qrmenu-cache/<musteriId>/<sha1>.bin + index.json */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'data', 'qrmenu-cache');
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const PREWARM_EVERY_MS = 30 * 60 * 1000;
const indexes = new Map(); // customerId -> { entries:{key:{f,status,type,at,size}}, total, dirty }

/* kopyalanmayacak yollar: yonetim, siparis/garson (canli islem), masa durumu (kisisel/anlik) */
function cacheable(method, key) {
  if (method !== 'GET') return false;
  const p = key.split('?')[0].toLowerCase();
  if (p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin')) return false;
  if (/^\/api\/(order|waiter-call|table-status|feedback|upsell-event|delivery-check|menu-link)\b/.test(p)) return false;
  if (p === '/garson' || p.startsWith('/garson')) return false;
  return true;
}
function dirOf(cid) { return path.join(ROOT, String(Number(cid))); }
function load(cid) {
  let ix = indexes.get(cid);
  if (ix) return ix;
  ix = { entries: {}, total: 0, dirty: false };
  try { ix.entries = JSON.parse(fs.readFileSync(path.join(dirOf(cid), 'index.json'), 'utf8')).entries || {}; } catch { /* ilk kez */ }
  ix.total = Object.values(ix.entries).reduce((a, e) => a + (e.size || 0), 0);
  indexes.set(cid, ix);
  return ix;
}
function saveIndex(cid) {
  const ix = indexes.get(cid); if (!ix || !ix.dirty) return;
  ix.dirty = false;
  try { fs.writeFileSync(path.join(dirOf(cid), 'index.json'), JSON.stringify({ entries: ix.entries })); } catch (e) { console.log('qrmenu-cache index yazilamadi', cid, e.message); }
}
setInterval(() => { for (const cid of indexes.keys()) saveIndex(cid); }, 15000).unref();

function put(cid, method, key, status, headers, buf) {
  try {
    if (!cacheable(method, key) || status !== 200 || !buf || buf.length > MAX_FILE) return;
    const h = headers || {};
    const lower = {}; Object.keys(h).forEach(k => { lower[k.toLowerCase()] = h[k]; });
    if (lower['set-cookie']) return;
    const ix = load(cid), old = ix.entries[key];
    if (ix.total - (old ? old.size : 0) + buf.length > MAX_TOTAL) return;
    fs.mkdirSync(dirOf(cid), { recursive: true });
    const f = crypto.createHash('sha1').update(key).digest('hex') + '.bin';
    fs.writeFileSync(path.join(dirOf(cid), f), buf);
    ix.total += buf.length - (old ? old.size : 0);
    ix.entries[key] = { f, status, type: lower['content-type'] || 'application/octet-stream', at: Date.now(), size: buf.length };
    ix.dirty = true;
  } catch (e) { console.log('qrmenu-cache yazilamadi', cid, key, e.message); }
}
function get(cid, key) {
  const ix = load(cid), e = ix.entries[key] || ix.entries[key.split('?')[0]];
  if (!e) return null;
  try { return { type: e.type, at: e.at, body: fs.readFileSync(path.join(dirOf(cid), e.f)) }; } catch { return null; }
}
function lastSaved(cid) {
  const ix = load(cid); let m = 0;
  for (const e of Object.values(ix.entries)) if (e.at > m) m = e.at;
  return m;
}

/* ---- on yukleme: musteri hic acmasa bile tum menu ve fotograflar kopyalansin */
const PAGES = ['/', '/siparis', '/iletisim', '/gizlilik-politikasi', '/eski', '/logo.png', '/manifest.webmanifest', '/reviews-strip.js',
  '/api/menu', '/api/menu?type=table', '/api/menu?type=delivery', '/api/menu?type=pickup', '/api/site-info', '/api/site-flags',
  '/api/campaigns', '/api/delivery-zones', '/api/order-tags', '/api/upsell-rules', '/api/order-acceptance', '/api/reviews'];
const running = new Set(), lastRun = new Map();
function collectImages(json, out) {
  if (!json || typeof json !== 'object') return;
  if (Array.isArray(json)) { json.forEach(v => collectImages(v, out)); return; }
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === 'string' && /^(imageUrl|image|photo|img)$/i.test(k) && v && !/^(https?:|data:)/i.test(v)) out.add(v);
    else if (v && typeof v === 'object') collectImages(v, out);
  }
}
function toPath(rel) {
  const clean = String(rel).replace(/^\.?\/+/, '');
  return '/' + clean.split('/').map(s => { try { return encodeURIComponent(decodeURIComponent(s)); } catch { return encodeURIComponent(s); } }).join('/');
}
async function prewarm(cid, send, force) {
  if (running.has(cid)) return;
  if (!force && Date.now() - (lastRun.get(cid) || 0) < PREWARM_EVERY_MS) return;
  running.add(cid); lastRun.set(cid, Date.now());
  let ok = 0, fail = 0;
  const fetchOne = async p => {
    try {
      const r = await send(cid, { method: 'GET', path: p, headers: { 'user-agent': 'EnsariPOS-Bulut-Kopya', accept: '*/*' }, bodyBase64: '' });
      const buf = Buffer.from(r.bodyBase64 || '', 'base64');
      put(cid, 'GET', p, r.status || 200, r.headers, buf);
      if ((r.status || 200) === 200) ok++; else fail++;
      return { status: r.status || 200, buf, type: String((r.headers || {})['content-type'] || (r.headers || {})['Content-Type'] || '') };
    } catch { fail++; return null; }
  };
  try {
    const imgs = new Set();
    for (const p of PAGES) {
      const r = await fetchOne(p);
      if (r && r.status === 200 && /json/i.test(r.type)) { try { collectImages(JSON.parse(r.buf.toString('utf8')), imgs); } catch { /* json degil */ } }
      if (r && r.status === 200 && /html/i.test(r.type)) {
        const re = /(?:src|href)="(\.?\/?[^"#?:]+\.(?:jpe?g|png|webp|gif|svg|ico|css))"/gi; let m;
        const t = r.buf.toString('utf8'); while ((m = re.exec(t))) imgs.add(m[1]);
      }
    }
    const list = [...imgs].map(toPath);
    for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map(fetchOne));
    saveIndex(cid);
    console.log(new Date().toISOString(), `qrmenu-cache on yukleme musteri ${cid}: ${ok} kaydedildi, ${fail} hata, ${list.length} fotograf`);
  } finally { running.delete(cid); }
}

/* cevrimdisi HTML'e ust serit: menu gezilebilir, siparis alinamaz */
function offlineBanner(html, savedAt) {
  const t = savedAt ? new Date(savedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const bar = `<div id="ensOffline" style="position:sticky;top:0;z-index:99999;background:#b4232f;color:#fff;font:600 13px/1.35 system-ui,sans-serif;padding:9px 12px;text-align:center">` +
    `Restoran şu an çevrimiçi değil — menüyü inceleyebilirsiniz, sipariş ve garson çağırma şu an alınamıyor.${t ? `<br><span style="font-weight:400;opacity:.85;font-size:11.5px">Fiyatlar ${t} itibarıyla</span>` : ''}</div>`;
  const s = html.toString('utf8');
  return Buffer.from(/<body[^>]*>/i.test(s) ? s.replace(/<body[^>]*>/i, m => m + bar) : bar + s, 'utf8');
}

module.exports = { put, get, prewarm, cacheable, offlineBanner, lastSaved };
