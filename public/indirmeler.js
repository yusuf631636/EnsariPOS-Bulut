/* Panellerdeki "İndirmeler" sekmesi (29.09.2026): Windows uygulamaları, Android APK'ları ve panel
   linkleri. Yönetici / bayi / müşteri panelleri AYNI listeyi kullanır - liste SADECE bu dosyada
   güncellenir. Hangi linklerin görüneceği kutunun data-mode değerine (admin/dealer/customer) göre
   değişir. Dosyaların kendisi web sitesinde: https://ornek-alanadi.com/downloads */
(function () {
  var SITE = 'https://ornek-alanadi.com';

  // 03.10.2026: urun sirasina gore; yeni (C#) surumu olan eski Node kurulumlari ve eski APK'lar
  // listeden kaldirildi (eski linkler Caddy'de yeni dosyaya yonlendirilir).
  var APPS = [
    { icon: '🛎️', name: 'EnsariPOS Local Garson — Ücretsiz', desc: 'Restoran bilgisayarında yerel çalışır (port 6363). Lisans sorgusu yok, paneli yok, internet gerekmez.', url: '/downloads/GarsonSistemiSetup.exe' },
    { icon: '🤵', name: 'Garson Direkt — SambaPOS Hazırlık Aracı', desc: 'Garson Direkt (bağımsız garson APK\'sı) için restoran bilgisayarında bir kez çalıştırılır: SambaPOS uygulama kaydı + 9000 portu.', url: '/downloads/GarsonDirektHazirlik.zip' },
    { icon: '📱', name: 'QR Menü', desc: 'Masadan sipariş, garson çağırma ve canlı menü. Node.js gerekmez; eski QR Menü kuruluysa menü/ayar/siparişler korunarak yerine geçer.', url: '/downloads/AlfaPOSQRMenuCSharpSetup.exe' },
    { icon: '🚀', name: 'Gelişmiş Kurye Sistemi', desc: 'Kurye atama, teslimat takibi ve tahsilat kontrolü. Node.js gerekmez; eski sürüm kuruluysa raporlar ve kurye oturumları korunarak yerine geçer.', url: '/downloads/GelismisKuryeCSharpSetup.exe' },
    { icon: '📦', name: 'Ultra Paketçi', desc: 'Paket servis ve kurye takip sistemi. Node.js gerekmez; eski sürüm kuruluysa raporlar/kurye oturumları/bildirimler korunarak yerine geçer.', url: '/downloads/UltraPaketciCSharpSetup.exe' },
    { icon: '📊', name: 'Patron Raporu', desc: 'Node.js gerekmez. AlfaPOS Bulut içindeki eski Patron kuruluysa şifreler, ayarlar ve bulut anahtarı korunarak onun yerine geçer.', url: '/downloads/PatronRaporuCSharpSetup.exe' },
    { icon: '🖥️', name: 'AlfaPOS Bulut (Kurye + Patron + QR Menü)', desc: 'Restoran bilgisayarına kurulan ana paket.', url: '/downloads/AlfaPOSBulutSetup.exe' }
  ];

  var APKS = [
    { icon: '🛎️', name: 'EnsariPOS Local Garson — Ücretsiz', url: '/downloads/apk/GarsonSistemi.apk' },
    { icon: '🤵', name: 'Garson Direkt (Bağımsız)', url: '/downloads/apk/GarsonDirekt.apk' },
    { icon: '📱', name: 'QR Menü Sistemi', url: '/downloads/apk/QRMenuSistemi.apk' },
    { icon: '🛠️', name: 'QR Menü Yönetim Paneli', url: '/downloads/apk/QRMenuAdminPaneli.apk' },
    { icon: '🚀', name: 'Gelişmiş Kurye — Kurye', url: '/downloads/apk/GelismisKuryeSistemi.apk' },
    { icon: '🚀', name: 'Gelişmiş Kurye — Restoran', url: '/downloads/apk/GelismisKuryeSistemi-Restoran.apk' },
    { icon: '📦', name: 'Ultra Paketçi — Kurye', url: '/downloads/apk/UltraPaketciV2.apk' },
    { icon: '📦', name: 'Ultra Paketçi — Restoran', url: '/downloads/apk/UltraPaketciV2-Restoran.apk' },
    { icon: '🛵', name: 'Kurye Bulut — Kurye', url: '/downloads/apk/KuryeSistemi.apk' },
    { icon: '🛵', name: 'Kurye Bulut — Restoran', url: '/downloads/apk/KuryeSistemi-Restoran.apk' },
    { icon: '📊', name: 'Patron Sistemi', url: '/downloads/apk/PatronSistemi.apk' },
    { icon: '🔐', name: 'Yönetim Paneli', url: '/downloads/apk/AdminPaneli.apk', who: ['admin'] }
  ];

  var ALL = ['admin', 'dealer', 'customer'];
  var LINKS = [
    { name: 'Web sitesi', url: 'https://ornek-alanadi.com', who: ALL },
    { name: 'Yönetici paneli', url: 'https://app.ornek-alanadi.com/admin', who: ['admin'] },
    { name: 'Site yönetimi', url: 'https://ornek-alanadi.com/site-yonetim/', who: ['admin'] },
    { name: 'Bayi paneli', url: 'https://app.ornek-alanadi.com/dealer', who: ['admin', 'dealer'] },
    { name: 'Müşteri paneli', url: 'https://app.ornek-alanadi.com/customer', who: ALL },
    { name: 'Patron raporu', url: 'https://patron2.ornek-alanadi.com', who: ALL },
    { name: 'QR Menü — restoran paneli', url: 'https://app.ornek-alanadi.com/qrmenu/', who: ALL },
    { name: 'Kurye Bulut — restoran', url: 'https://kuryebulut.ornek-alanadi.com/restoran', who: ALL },
    { name: 'Kurye Bulut — kurye', url: 'https://kuryebulut.ornek-alanadi.com', who: ALL },
    { name: 'Gelişmiş Kurye — restoran', url: 'https://kuryeler.ornek-alanadi.com/restoran', who: ALL },
    { name: 'Gelişmiş Kurye — kurye', url: 'https://kuryeler.ornek-alanadi.com/courier', who: ALL },
    { name: 'Ultra Paketçi — restoran', url: 'https://ultra.ornek-alanadi.com/restoran', who: ALL },
    { name: 'Ultra Paketçi — kurye', url: 'https://ultra.ornek-alanadi.com/courier', who: ALL },
    { name: 'Demo (Gelişmiş Kurye önizleme)', url: 'https://test.ornek-alanadi.com', who: ['admin', 'dealer'] },
    { name: 'Bursa Lokantacılar sitesi', url: 'https://bursalokantacilar.ornek-alanadi.com', who: ['admin'] },
    { name: 'Bursa Lokantacılar yönetim', url: 'https://bursalokantacilar.ornek-alanadi.com/yonetim/', who: ['admin'] }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function visible(item, mode) { return !item.who || item.who.indexOf(mode) !== -1; }
  var ROW = 'display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);margin-bottom:8px';
  var ICON = 'font-size:22px;width:30px;text-align:center;flex-shrink:0';
  var TEXT = 'flex:1;min-width:0';
  var SUB = 'font-size:12px;color:var(--muted);margin-top:2px;word-break:break-all';
  // .btn'in zemini satirla ayni (surface-2) - Kopyala dugmesi yazi gibi durmasin diye
  var COPY = 'background:var(--surface);border:1px solid var(--line)';

  function fileRow(item) {
    return '<div style="' + ROW + '"><span style="' + ICON + '">' + esc(item.icon) + '</span>' +
      '<div style="' + TEXT + '"><div style="font-weight:600">' + esc(item.name) + '</div>' +
      (item.desc ? '<div style="' + SUB + '">' + esc(item.desc) + '</div>' : '') + '</div>' +
      '<a class="btn small primary" href="' + esc(SITE + item.url) + '" download>İndir</a></div>';
  }
  function linkRow(item) {
    return '<div style="' + ROW + '"><div style="' + TEXT + '"><div style="font-weight:600">' + esc(item.name) + '</div>' +
      '<div style="' + SUB + '">' + esc(item.url) + '</div></div>' +
      '<button type="button" class="btn small" style="' + COPY + '" data-copy="' + esc(item.url) + '">Kopyala</button>' +
      '<a class="btn small primary" href="' + esc(item.url) + '" target="_blank" rel="noopener">Aç</a></div>';
  }

  function render(box) {
    var mode = box.getAttribute('data-mode') || 'customer';
    box.innerHTML =
      '<div class="card"><h2>Windows Uygulamaları</h2>' +
      '<p class="muted" style="margin:0 0 12px">Restoran bilgisayarına kurulan programlar. Her zaman en güncel sürüm iner.</p>' +
      APPS.filter(function (i) { return visible(i, mode); }).map(fileRow).join('') + '</div>' +
      '<div class="card"><h2>Android Uygulamaları (APK)</h2>' +
      '<p class="muted" style="margin:0 0 12px">Telefona/tablete kurulur. Telefonda "bilinmeyen kaynaklardan yüklemeye izin ver" istenebilir.</p>' +
      APKS.filter(function (i) { return visible(i, mode); }).map(fileRow).join('') + '</div>' +
      '<div class="card"><h2>Paneller ve Linkler</h2>' +
      '<p class="muted" style="margin:0 0 12px">"Kopyala" ile linki alıp müşterinize / kuryenize gönderebilirsiniz.</p>' +
      LINKS.filter(function (i) { return visible(i, mode); }).map(linkRow).join('') + '</div>';

    box.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (!btn) return;
      var text = btn.getAttribute('data-copy');
      var done = function () { var old = btn.textContent; btn.textContent = 'Kopyalandı ✓'; setTimeout(function () { btn.textContent = old; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { window.prompt('Linki kopyalayın:', text); });
      } else {
        window.prompt('Linki kopyalayın:', text);
      }
    });
  }

  function init() {
    var box = document.getElementById('indirmelerBox');
    if (box) render(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
