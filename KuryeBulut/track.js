const { db } = require('../db');

/* Herkese acik, kimlik dogrulamasiz uc nokta - sadece indirme dugmesine
   tiklandiginda bir sayaci arttirir. Hicbir kisisel veri toplanmaz. */
const ALLOWED_FILES = new Set(['kurye', 'patron', 'hepsi']);

async function trackDownload(req, res) {
  // Tanitim sitesi (ornek-alanadi.com) farkli bir domain'den (app.ornek-alanadi.com)
  // bu uc noktayi fetch ile cagiracagi icin CORS izni gerekir - burasi
  // kimlik dogrulamasiz/kisisel veri icermeyen basit bir sayac oldugu icin
  // acik izin vermek risksiz (cerez/oturum kullanilmiyor).
  res.setHeader('Access-Control-Allow-Origin', '*');
  const body = await require('../auth').readJsonBody(req).catch(() => ({}));
  const file = String(body.file || '').trim();
  if (!ALLOWED_FILES.has(file)) return { status: 400, body: { error: 'Geçersiz dosya.' } };
  db.prepare(`
    INSERT INTO download_counts (file, count, last_at) VALUES (?, 1, ?)
    ON CONFLICT(file) DO UPDATE SET count = count + 1, last_at = excluded.last_at
  `).run(file, new Date().toISOString());
  return { status: 200, body: { ok: true } };
}

module.exports = [
  { method: 'POST', path: '/api/track/download', handler: trackDownload }
];
