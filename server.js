const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const agentWs = require('./KuryeBulut/agent-ws');
const patronWs = require('./Patron/patron-ws');
const gkTunnel = require('./KuryeSistemi/gk-tunnel');
const gkWeb = require('./KuryeSistemi/gk-web');
const gsTunnel = require('./GarsonSistemi/gs-tunnel');
const gsWeb = require('./GarsonSistemi/gs-web');
const ultraTunnel = require('./UltraPaketci/ultra-tunnel');
const ultraWeb = require('./UltraPaketci/ultra-web');
const qrmenuTunnel = require('./QRMenu/qrmenu-tunnel');
const qrmenuWeb = require('./QRMenu/qrmenu-web');

const configPath = path.join(__dirname, 'config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const PORT = Number(process.env.PORT || config.port || 8888);
const ROOT = __dirname;

// Coklu-kiracili (multi-tenant) sunucu: tek bir istekteki/ajan mesajindaki
// beklenmedik hata TUM musterileri etkileyip sunucuyu coktermemeli. Ayri ayri
// try/catch'lere ek olarak, kacan herhangi bir hatayi da son çare olarak
// burada yakalayip sadece loglariz - process.exit YAPMAYIZ.
process.on('uncaughtException', error => console.error(new Date().toISOString(), 'YAKALANMAMIS HATA:', error));
process.on('unhandledRejection', error => console.error(new Date().toISOString(), 'YAKALANMAMIS PROMISE HATASI:', error));

const routeModules = [
  require('./routes/admin-auth'),
  require('./routes/admin'),
  require('./routes/dealer-auth'),
  require('./routes/dealer'),
  require('./routes/customer-auth'),
  require('./routes/customer'),
  require('./KuryeBulut/courier-auth'),
  require('./KuryeBulut/courier'),
  require('./Patron/agent'),
  require('./KuryeBulut/track')
];
const routes = routeModules.flat();

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  const map = {
    '/': '/index.html',
    '/admin': '/admin/index.html',
    '/dealer': '/dealer/index.html',
    '/customer': '/customer/index.html',
    '/kurye-restoran': '/kurye-restoran/index.html',
    '/patron2': '/patron2/index.html',
    '/courier': '/courier/index.html'
  };
  const rel = map[pathname] || pathname;
  const file = path.join(ROOT, 'public', rel);
  if (!file.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(res, 404, { error: 'Bulunamadı' });
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

/* '/api/<rol>/...' - hangi rolun cerezine bakilacagini URL'den sabitler.
   auth.js:currentSession()'daki sabit oncelik sirasi (admin > dealer >
   customer > courier) yerine bunu kullanmak sart: aksi halde ayni tarayicida
   birden fazla rol oturumu ACIKKEN (orn. admin panelinden yeni eklenen bir
   musteriyi ayni tarayicida test ederken) daha yuksek oncelikli rolun cerezi
   dogru cerezin onune gecip requireRole()'u sessizce reddeder. */
const ROLE_PATH = /^\/api\/(admin|dealer|customer|courier)\//;
function sessionFor(req, pathname) {
  const match = ROLE_PATH.exec(pathname);
  return match ? auth.sessionForRole(req, match[1]) : auth.currentSession(req);
}

/* Android TWA (APK) uygulamalarimizin "gercek uygulama gibi" (adres cubugu
   olmadan) acilmasi icin her ilgili domain kendi Digital Asset Links dosyasini
   yayinlamali - Android bunu paket adi + imzalama sertifikasi parmak iziyle
   dogrulayip TAM EKRAN modunu acar. Hepsi AYNI ortak anahtarla (ensaripos.keystore)
   imzalandigi icin parmak izi hepsinde ayni, sadece paket adi degisiyor. */
const ANDROID_APP_HOSTS = {
  'kuryeler.ornek-alanadi.com': ['com.ensaripos.gelismiskurye', 'com.ensaripos.gelismiskurye.restoran'],
  'kuryebulut.ornek-alanadi.com': ['com.ensaripos.kurye', 'com.ensaripos.kurye.restoran'],
  'patron2.ornek-alanadi.com': ['com.ensaripos.patron'],
  'app.ornek-alanadi.com': ['com.ensaripos.qrmenu', 'com.ensaripos.admin'],
  'garson.ornek-alanadi.com': ['com.ensaripos.garson', 'com.ensaripos.garson.restoran'],
  'ultra.ornek-alanadi.com': ['com.ensaripos.ultrapaketci', 'com.ensaripos.ultrapaketci.restoran'],
};
const ANDROID_APP_SHA256 = 'ED:E4:78:82:1F:10:AD:59:ED:F0:C7:77:FD:A5:06:1A:84:2D:C3:EF:E5:EB:90:9D:85:09:76:DF:06:78:25:F3';

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    // kuryeler.ornek-alanadi.com TAMAMEN AYRI bir uygulamadir (gk-web.js, tunel uzerinden
    // restoran bilgisayarina proxy eder) - normal route/serveStatic mantigina HIC
    // girmez, path'leri (/courier, /api/... vb.) digerleriyle CAKISSA bile karismaz.
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (u.pathname === '/.well-known/assetlinks.json' && ANDROID_APP_HOSTS[host]) {
      const body = JSON.stringify(ANDROID_APP_HOSTS[host].map(packageName => ({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: [ANDROID_APP_SHA256] }
      })));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      return res.end(body);
    }
    if (host === 'kuryeler.ornek-alanadi.com') return gkWeb.handle(req, res, u);
    if (host === 'ultra.ornek-alanadi.com') return ultraWeb.handle(req, res, u);
    if (host === 'garson.ornek-alanadi.com') return gsWeb.handle(req, res, u);
    // QR Menü: menu.ornek-alanadi.com HERKESE ACIK slug modu (musteri QR okutur,
    // secim formuyla KARSILASMAZ); app.ornek-alanadi.com/qrmenu* ise restoran
    // sahibinin giris noktasi (secim formu + cerez) - bkz. routes/qrmenu-web.js.
    if (host === 'menu.ornek-alanadi.com') return qrmenuWeb.handleSlug(req, res, u);
    if (host === 'app.ornek-alanadi.com' && (u.pathname === '/qrmenu' || u.pathname.startsWith('/qrmenu/'))) return qrmenuWeb.handlePicker(req, res, u);
    // Kiosk QR odeme (iyzico) donus sayfasi (03.10.2026): musterinin telefonu odemeden sonra buraya
    // yonlenir (iyzico GET/POST eder). Sonuc kiosk tarafindan token ile dogrulanir; bu sayfa sadece bilgilendirir.
    if (u.pathname === '/kiosk/odeme-sonuc') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ödeme</title></head>' +
        '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf6ee;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#2a1c14;text-align:center;padding:24px">' +
        '<div style="background:#fff;border-radius:22px;padding:34px 26px;box-shadow:0 10px 30px rgba(0,0,0,.08);max-width:420px"><div style="font-size:64px">✅</div>' +
        '<h1 style="font-size:22px;margin:12px 0 8px">İşlem tamamlandı</h1><p style="color:#8a7a68;line-height:1.5;margin:0">Ödeme sonucunuz ve sipariş numaranız kiosk ekranında görünecek. Bu sayfayı kapatabilirsiniz.</p></div></body></html>');
    }
    const route = routes.find(r => r.method === req.method && r.path === u.pathname);
    if (route) {
      const session = sessionFor(req, u.pathname);
      const result = await route.handler(req, res, session, u.searchParams);
      return json(res, result.status, result.body);
    }
    if (req.method === 'GET') return serveStatic(req, res, u.pathname);
    return json(res, 404, { error: 'Bulunamadı' });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
});

agentWs.attach(server);
patronWs.attach(server);
gkTunnel.attach(server);
gsTunnel.attach(server);
ultraTunnel.attach(server);
qrmenuTunnel.attach(server);
// Hicbiri sahiplenmediyse (bilinmeyen path) - EN SONDA eklenen bu dinleyici calisir
// ve baglantiyi kapatir. 'upgrade' dinleyicileri KAYIT SIRASINA gore calisir, bu
// yuzden bu satir HER ZAMAN en altta kalmali.
server.on('upgrade', (req, socket) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname !== '/agent-ws' && u.pathname !== '/patron-ws' && u.pathname !== '/gk-tunnel' && u.pathname !== '/gs-tunnel' && u.pathname !== '/ultra-tunnel' && u.pathname !== '/qrmenu-tunnel') socket.destroy();
});
server.listen(PORT, '127.0.0.1', () => console.log(`AlfaPOS Bulut: http://127.0.0.1:${PORT}`));
