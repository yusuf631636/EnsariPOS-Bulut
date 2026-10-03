async function api(path, options) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu.');
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  try { localStorage.setItem('ensari-theme', theme); } catch { /* gizli gezinti modu olabilir */ }
}
try { setTheme(localStorage.getItem('ensari-theme') || 'dark'); } catch { setTheme('dark'); }
document.getElementById('themeToggle').addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));

document.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg[data-pane]');
  if (!seg) return;
  document.querySelectorAll('.seg[data-pane]').forEach(s => s.classList.toggle('active', s === seg));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === seg.dataset.pane));
  if (seg.dataset.pane === 'pane-harita') { ensureMap(); setTimeout(() => map.invalidateSize(), 50); }
});

const loginView = document.getElementById('login');
const appView = document.getElementById('app');
const loginForm = document.getElementById('loginForm');
const activateForm = document.getElementById('activateForm');

document.getElementById('tabLogin').addEventListener('click', () => switchTab(true));
document.getElementById('tabActivate').addEventListener('click', () => switchTab(false));
function switchTab(isLogin) {
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabActivate').classList.toggle('active', !isLogin);
  loginForm.hidden = !isLogin;
  activateForm.hidden = isLogin;
  document.getElementById('loginErr').hidden = true;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('loginErr');
  errBox.hidden = true;
  try {
    await api('/api/customer/login', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) });
    enterApp();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
});

activateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('loginErr');
  errBox.hidden = true;
  try {
    await api('/api/customer/activate', { method: 'POST', body: JSON.stringify({ activationKey: actKey.value, password: actPassword.value }) });
    switchTab(true);
    username.value = actKey.value;
    errBox.hidden = false;
    errBox.className = 'ok';
    errBox.textContent = 'Şifreniz belirlendi, şimdi giriş yapabilirsiniz.';
  } catch (err) {
    errBox.className = 'err';
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  clearInterval(pollTimer);
  await api('/api/customer/logout', { method: 'POST' });
  location.reload();
});

/* Ayni panel/oturum/sifre uc farkli akilda kalici adresten acilabiliyor
   (app.ornek-alanadi.com/customer = tam görünüm, kuryebulut.ornek-alanadi.com =
   sadece kurye yönetimi, patron2.ornek-alanadi.com = sadece Patron Raporu).
   Hicbir yeni giris/oturum sistemi YOK - ayni kullanici adi+sifre, sadece
   hangi sekmelerin gorunecegi ve hangisinin varsayilan acilacagi hostname'e
   gore degisiyor. app.ornek-alanadi.com'da (varsayilan) hicbir sey gizlenmez -
   mevcut musteriler icin davranis birebir aynidir. */
const HOST_VIEWS = {
  'kuryebulut.ornek-alanadi.com': { show: ['pane-genel', 'pane-kuryeler', 'pane-harita', 'pane-raporlar', 'pane-indirmeler'], defaultPane: 'pane-kuryeler', label: 'Kurye Paneli' },
  'patron2.ornek-alanadi.com': { show: ['pane-patron', 'pane-indirmeler'], defaultPane: 'pane-patron', label: 'Patron Paneli' }
};
/* Hangi adresten girildigi hem sekme cubugunda hem sayfa basliginda/tarayici
   sekmesinde ACIKCA belli olsun diye - kullanici "hangi ekrandayim"
   diye tahmin etmek zorunda kalmasin. */
function applyHostView() {
  const view = HOST_VIEWS[location.hostname];
  if (!view) return; // app.ornek-alanadi.com veya baska bir adres - hicbir sey degismez
  document.querySelectorAll('.seg[data-pane]').forEach(seg => {
    const visible = view.show.includes(seg.dataset.pane);
    seg.hidden = !visible;
    seg.classList.toggle('active', visible && seg.dataset.pane === view.defaultPane);
  });
  document.querySelectorAll('.pane').forEach(pane => { pane.classList.toggle('active', pane.id === view.defaultPane); });
  if (view.show.length <= 1) document.querySelector('.segbar').hidden = true;
  document.title = `${view.label} — AlfaPOS Bulut`;
}
function hostLabelSuffix() {
  const view = HOST_VIEWS[location.hostname];
  return view ? ` — ${view.label}` : '';
}

let pollTimer = null;
function enterApp() {
  loginView.hidden = true;
  appView.hidden = false;
  applyHostView();
  const todayStr = new Date().toISOString().slice(0, 10);
  document.getElementById('reportDate').value = todayStr;
  document.getElementById('patronStart').value = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  document.getElementById('patronEnd').value = todayStr;
  refreshAll();
  loadReport();
  loadPatronReport();
  pollTimer = setInterval(refreshAll, 20000);
}
function refreshAll() { loadSummary(); loadCouriers(); loadLocations(); loadOrders(); loadTodayStats(); }
document.getElementById('reportDate').addEventListener('change', loadReport);

/* "Patron Raporu" sekmesindeki tarih araligi tablosu. */
document.getElementById('patronStart').addEventListener('change', loadPatronReport);
document.getElementById('patronEnd').addEventListener('change', loadPatronReport);

/* Fiyat guncelleme - restoran bilgisayarindaki C:\ensari\patron-cloud.js'e
   /api/customer/patron-price uzerinden komut kuyruklanir, durumu burada
   birkac saniyede bir sorgulanir (qrmenu panelindeki ayni "sirada/gonderildi/
   uygulandi" fikrinin sadelestirilmis hali). */
let patronSearchTimer = null;
document.getElementById('patronMenuSearch').addEventListener('input', () => {
  clearTimeout(patronSearchTimer);
  patronSearchTimer = setTimeout(loadPatronMenuSearch, 300);
});
async function loadPatronMenuSearch() {
  const box = document.getElementById('patronMenuResults');
  const q = document.getElementById('patronMenuSearch').value.trim();
  if (!q) { box.innerHTML = '<p class="muted">Aramak için yazmaya başlayın.</p>'; return; }
  try {
    const { items } = await api(`/api/customer/patron-menu?q=${encodeURIComponent(q)}`);
    if (!items.length) { box.innerHTML = '<p class="muted">Sonuç yok.</p>'; return; }
    box.innerHTML = items.map(i => `
      <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
        <span>${esc(i.item_name)}${i.portion_name && i.portion_name !== 'Normal' ? ' — ' + esc(i.portion_name) : ''}${i.tag_label && i.tag_label !== 'Standart' ? ' (' + esc(i.tag_label) + ')' : ''}<br><span class="muted">Mevcut: ${money(i.price)}</span></span>
        <span style="display:flex;gap:6px;align-items:center">
          <input type="text" inputmode="decimal" placeholder="Yeni fiyat" data-price-input="${i.price_id}" style="width:100px">
          <button class="btn small" data-price-send="${i.price_id}">Gönder</button>
          <span class="muted" data-price-badge="${i.price_id}"></span>
        </span>
      </div>`).join('');
  } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

document.getElementById('patronMenuResults').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-price-send]');
  if (!btn) return;
  const priceId = Number(btn.dataset.priceSend);
  const input = document.querySelector(`[data-price-input="${priceId}"]`);
  const badge = document.querySelector(`[data-price-badge="${priceId}"]`);
  if (!input.value.trim()) return;
  btn.disabled = true;
  badge.textContent = '';
  try {
    const result = await api('/api/customer/patron-price', { method: 'POST', body: JSON.stringify({ priceId, price: input.value.trim() }) });
    badge.textContent = result.connected ? 'gönderildi…' : 'sırada (restoran bilgisayarı bağlı değil)…';
    pollPatronPrice(result.id, priceId, badge, btn);
  } catch (err) { badge.textContent = err.message; btn.disabled = false; }
});

function pollPatronPrice(id, priceId, badge, btn, attempt) {
  attempt = attempt || 0;
  if (attempt > 20) { badge.textContent = 'zaman aşımı, tekrar deneyin'; btn.disabled = false; return; }
  setTimeout(async () => {
    try {
      const status = await api(`/api/customer/patron-price-status?id=${id}`);
      if (status.state === 'uygulandi') { badge.textContent = `✓ uygulandı (${money(status.newPrice)})`; btn.disabled = false; return; }
      if (status.state === 'hata') { badge.textContent = 'hata: ' + (status.error || 'bilinmeyen'); btn.disabled = false; return; }
      pollPatronPrice(id, priceId, badge, btn, attempt + 1);
    } catch { pollPatronPrice(id, priceId, badge, btn, attempt + 1); }
  }, 2000);
}

async function loadPatronReport() {
  const grid = document.getElementById('patronReportGrid');
  try {
    const start = document.getElementById('patronStart').value;
    const end = document.getElementById('patronEnd').value;
    const { days, totals } = await api(`/api/customer/patron-report?start=${start}&end=${end}`);
    if (!days.length) { grid.innerHTML = '<p class="muted">Bu tarih aralığında rapor yok.</p>'; return; }
    grid.innerHTML = `
      <table><thead><tr><th>Tarih</th><th>Ciro</th><th>Adisyon</th><th>Açık bakiye</th></tr></thead><tbody>
        ${days.map(d => `<tr><td>${esc(d.report_date)}</td><td>${money(d.sales)}</td><td>${esc(d.tickets)}</td><td>${money(d.remaining)}</td></tr>`).join('')}
      </tbody><tfoot><tr style="font-weight:600"><td>Toplam</td><td>${money(totals.sales)}</td><td>${esc(totals.tickets)}</td><td>${money(totals.remaining)}</td></tr></tfoot></table>`;
  } catch (err) { grid.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

/* "Genel" sekmesindeki tek tek siparis listesi. */
async function loadOrders() {
  try {
    const { orders } = await api('/api/customer/orders');
    document.getElementById('orderCount').textContent = `(${orders.length})`;
    document.getElementById('ordersList').innerHTML = orders.length ? orders.map(o => `
      <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
        <span>${esc(o.customerName)} · ${esc(o.courierName)}<br><span class="muted">Fiş ${esc(o.number)} · ${esc(o.packageStatus)}</span></span>
        <span>${money(o.total)}</span>
      </div>`).join('') : '<p class="muted">Aktif sipariş yok.</p>';
  } catch { /* sessizce gec */ }
}

/* Ust taraftaki "Bugun" 3 istatistik kutucugu - kurye-report (bugun) ve
   couriers uc noktalarindan turetilir, ekstra bir backend cagrisi gerekmez. */
async function loadTodayStats() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [report, couriersRes] = await Promise.all([
      api(`/api/customer/courier-report?date=${today}`),
      api('/api/customer/couriers')
    ]);
    const deliveredCount = report.summary.reduce((sum, r) => sum + r.count, 0);
    const deliveredTotal = report.summary.reduce((sum, r) => sum + r.total, 0);
    const activeCouriers = couriersRes.couriers.filter(c => c.pending + c.enroute > 0).length;
    document.getElementById('statDelivered').textContent = deliveredCount;
    document.getElementById('statRevenue').textContent = money(deliveredTotal);
    document.getElementById('statActiveCouriers').textContent = activeCouriers;
  } catch { /* sessizce gec */ }
}

function ago(ms) {
  const diff = Math.max(0, Math.round((Date.now() - Number(ms)) / 1000));
  if (diff < 60) return `${diff} sn önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  return `${Math.floor(diff / 3600)} sa önce`;
}

let map = null, markers = new Map(), mapCentered = false;
function ensureMap() {
  if (map) return;
  map = L.map('map').setView([39.92, 32.85], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
}
async function loadLocations() {
  try {
    const { locations } = await api('/api/customer/locations');
    ensureMap();
    document.getElementById('locationList').innerHTML = locations.length ? locations.map(l => `
      <div class="row" data-focus-courier="${esc(l.courier_name)}" style="padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer"><span><b>${esc(l.courier_name)}</b></span><span class="muted">${ago(l.updated_at)}</span></div>
    `).join('') : '<p class="muted">Henüz konum paylaşan kurye yok.</p>';
    const seen = new Set();
    locations.forEach(l => {
      seen.add(l.courier_name);
      const pos = [l.lat, l.lng];
      if (markers.has(l.courier_name)) markers.get(l.courier_name).setLatLng(pos);
      else markers.set(l.courier_name, L.marker(pos).addTo(map).bindPopup(esc(l.courier_name)));
      markers.get(l.courier_name).setPopupContent(`<b>${esc(l.courier_name)}</b><br>${ago(l.updated_at)}`);
    });
    for (const [name, marker] of markers) if (!seen.has(name)) { map.removeLayer(marker); markers.delete(name); }
    if (locations.length && !mapCentered) { map.setView([locations[0].lat, locations[0].lng], 13); mapCentered = true; }
  } catch { /* harita olmadan da panel calisir */ }
}

async function loadSummary() {
  try {
    const result = await api('/api/customer/summary');
    document.getElementById('bizName').textContent = (result.businessName || 'Restoran Paneli') + hostLabelSuffix();
    document.getElementById('summaryBox').innerHTML = renderSnapshot(result.data, result.updatedAt);
  } catch (err) {
    document.getElementById('summaryBox').innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

/* Acik adisyon satirina tiklama - patron2/app.js ile BIREBIR AYNI ozellik
   (kod tekrari kucuk ve iki panel bagimsiz kalsin diye kabul edildi, diger
   Patron parcalari da zaten boyle kopyalanmis - dosya basindaki nota bakin). */
function closeTicketModal() { const el = document.getElementById('ticketModal'); if (el) el.remove(); }
function openTicketModal(label) {
  closeTicketModal();
  const overlay = document.createElement('div');
  overlay.id = 'ticketModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">
    <div class="row"><h2>${esc(label || 'Adisyon')}</h2><button class="close-x" id="ticketModalClose">✕</button></div>
    <div id="ticketModalBody"><p class="muted">İsteniyor…</p></div>
  </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTicketModal(); });
  overlay.querySelector('#ticketModalClose').addEventListener('click', closeTicketModal);
  document.body.appendChild(overlay);
}
function pollPatronTicket(id, attempt) {
  attempt = attempt || 0;
  const body = document.getElementById('ticketModalBody');
  if (!body) return;
  if (attempt > 20) { body.innerHTML = '<p class="err">Zaman aşımı — restoran bilgisayarı kapalı olabilir.</p>'; return; }
  setTimeout(async () => {
    const body2 = document.getElementById('ticketModalBody');
    if (!body2) return;
    try {
      const status = await api(`/api/customer/patron-price-status?id=${id}`);
      if (status.state === 'uygulandi') {
        const items = status.items || [];
        if (!items.length) { body2.innerHTML = '<p class="muted">Bu adisyonda ürün yok.</p>'; return; }
        const total = items.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
        body2.innerHTML = `<table><thead><tr><th>Ürün</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>
          ${items.map(it => `<tr><td>${esc(it.name)}${it.portion ? ` <span class="muted">${esc(it.portion)}</span>` : ''}</td><td>${esc(it.quantity)}</td><td>${money(it.total)}</td></tr>`).join('')}
        </tbody></table><div class="total-row"><span>Toplam</span><span>${money(total)}</span></div>`;
        return;
      }
      if (status.state === 'hata') { body2.innerHTML = `<p class="err">${esc(status.error || 'bilinmeyen hata')}</p>`; return; }
      pollPatronTicket(id, attempt + 1);
    } catch { pollPatronTicket(id, attempt + 1); }
  }, 1500);
}
document.getElementById('summaryBox').addEventListener('click', async (e) => {
  const row = e.target.closest('.ticket-row');
  if (!row) return;
  const ticketId = Number(row.dataset.ticketId);
  if (!ticketId) return;
  openTicketModal(row.dataset.ticketLabel);
  try {
    const result = await api('/api/customer/patron-ticket', { method: 'POST', body: JSON.stringify({ ticketId }) });
    if (!result.connected) { const b = document.getElementById('ticketModalBody'); if (b) b.innerHTML = '<p class="muted">Restoran bilgisayarı bağlı değil, sırada bekleniyor…</p>'; }
    pollPatronTicket(result.id);
  } catch (err) { const b = document.getElementById('ticketModalBody'); if (b) b.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
});

/* Saat araligi sorgulama ("Saat Aralığı Sorgula" karti, Patron Raporu
   sekmesinde) - gunluk push SADECE bugunu tasidigi icin, secilen tarih/saat
   araligi restoran bilgisayarindan CANLI istenir (patron-ticket/patron-price
   ile AYNI kuyruklama/durum-sorgulama deseni). patron2/app.js'in BAGIMSIZ
   kopyasi (bu dosyanin basindaki mevcut kopyalama ilkesiyle ayni). */
(function initHourlyQuery() {
  const hourStartSel = document.getElementById('hourlyHourStart'), hourEndSel = document.getElementById('hourlyHourEnd');
  if (!hourStartSel || !hourEndSel) return;
  const opts = '<option value="">—</option>' + Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
  hourStartSel.innerHTML = opts; hourEndSel.innerHTML = opts;
  const todayStr = new Date().toISOString().slice(0, 10);
  document.getElementById('hourlyStart').value = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  document.getElementById('hourlyEnd').value = todayStr;
  document.getElementById('hourlyQueryBtn').addEventListener('click', runHourlyQuery);
})();
function hourlyBarChart(hourly) {
  if (!hourly || !hourly.length) return '<p class="muted">Bu aralıkta kayıt yok.</p>';
  const max = Math.max(...hourly.map(h => Number(h.amount) || 0), 1);
  return `<div class="bar-chart" style="margin:10px 0">${hourly.map(h => `
    <div class="bar-row">
      <span class="muted">${String(h.hour).padStart(2, '0')}:00</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round((Number(h.amount) || 0) / max * 100))}%"></div></div>
      <span class="n">${money(h.amount)}</span>
    </div>`).join('')}</div>`;
}
async function runHourlyQuery() {
  const box = document.getElementById('hourlyQueryResult');
  const btn = document.getElementById('hourlyQueryBtn');
  const start = document.getElementById('hourlyStart').value, end = document.getElementById('hourlyEnd').value;
  if (!start || !end) return;
  const hourStart = document.getElementById('hourlyHourStart').value, hourEnd = document.getElementById('hourlyHourEnd').value;
  btn.disabled = true;
  box.innerHTML = '<p class="muted">İsteniyor…</p>';
  try {
    const result = await api('/api/customer/patron-hourly', { method: 'POST', body: JSON.stringify({ start, end, hourStart, hourEnd }) });
    if (!result.connected) box.innerHTML = '<p class="muted">Restoran bilgisayarı bağlı değil, sırada bekleniyor…</p>';
    pollHourlyQuery(result.id, box, btn);
  } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; btn.disabled = false; }
}
function pollHourlyQuery(id, box, btn, attempt) {
  attempt = attempt || 0;
  if (attempt > 20) { box.innerHTML = '<p class="err">Zaman aşımı — restoran bilgisayarı kapalı olabilir.</p>'; btn.disabled = false; return; }
  setTimeout(async () => {
    try {
      const status = await api(`/api/customer/patron-price-status?id=${id}`);
      if (status.state === 'uygulandi') {
        const data = status.data, s = data.summary;
        box.innerHTML = `
          <div class="card-grid" style="margin-bottom:10px">
            <div class="stat"><div class="n">${money(s.sales)}</div><div class="l">Toplam ciro</div></div>
            <div class="stat"><div class="n">${s.tickets}</div><div class="l">Adisyon</div></div>
            <div class="stat"><div class="n">${money(s.average)}</div><div class="l">Ortalama</div></div>
          </div>
          ${hourlyBarChart(data.hourly)}`;
        btn.disabled = false;
        return;
      }
      if (status.state === 'hata') { box.innerHTML = `<p class="err">${esc(status.error || 'bilinmeyen hata')}</p>`; btn.disabled = false; return; }
      pollHourlyQuery(id, box, btn, attempt + 1);
    } catch { pollHourlyQuery(id, box, btn, attempt + 1); }
  }, 1500);
}

async function loadCouriers() {
  try {
    const { couriers } = await api('/api/customer/couriers');
    document.getElementById('courierList').innerHTML = couriers.length ? couriers.map(c => `
      <div class="card" style="background:var(--surface-2);margin-bottom:10px">
        <div class="row" data-focus-courier="${esc(c.name)}" style="margin-bottom:8px;cursor:pointer"><b>${esc(c.name)}</b><span class="muted">${c.pending} bekliyor · ${c.enroute} yolda</span></div>
        <div class="badge active" style="margin-bottom:8px">🔑 Giriş şifresi (PIN): ${esc(c.pin)}</div>
        <input type="tel" placeholder="Telefon (05XX XXX XX XX)" value="${esc(c.phone)}" data-phone-input="${esc(c.name)}" style="margin-bottom:8px">
        <button class="btn small" data-save-phone="${esc(c.name)}">Kaydet</button>
      </div>`).join('') : '<p class="muted">Henüz kurye verisi gelmedi.</p>';
    renderCourierStatus(couriers);
  } catch { /* ozet zaten hata gosteriyor olabilir, sessiz gec */ }
}

/* "Hangi kuryede paket var" - her kurye icin ayri kart, elinde paket olan
   (bekliyor+yolda>0) kuryeler vurgulanir, bos olanlar da gorunur kalir. */
function renderCourierStatus(couriers) {
  const grid = document.getElementById('courierStatusGrid');
  if (!couriers.length) { grid.innerHTML = '<p class="muted">Henüz kurye verisi gelmedi.</p>'; return; }
  grid.innerHTML = couriers.map(c => {
    const active = c.pending + c.enroute > 0;
    return `
      <div class="stat" data-focus-courier="${esc(c.name)}" style="cursor:pointer${active ? ';border-color:var(--s1)' : ''}">
        <div class="n">${c.pending + c.enroute}</div>
        <div class="l">${esc(c.name)} — ${c.pending} bekliyor · ${c.enroute} yolda</div>
      </div>`;
  }).join('');
}

/* Kurye kartina (hangi kuryede paket var / kurye listesi) basilinca haritadaki
   ilgili isaretciye kayar ve konum balonunu acar - konumu yoksa bilgi verir. */
function focusCourier(name) {
  document.querySelector('.seg[data-pane="pane-harita"]').click();
  const marker = markers.get(name);
  if (!marker) { alert(`${name} henüz konum paylaşmıyor.`); return; }
  setTimeout(() => { map.setView(marker.getLatLng(), 17); marker.openPopup(); }, 80);
}

async function loadReport() {
  const grid = document.getElementById('reportGrid');
  try {
    const date = document.getElementById('reportDate').value;
    const { summary } = await api(`/api/customer/courier-report?date=${date}`);
    if (!summary.length) { grid.innerHTML = '<p class="muted">Bu tarihte teslimat yok.</p>'; return; }
    const total = summary.reduce((sum, r) => sum + r.total, 0);
    grid.innerHTML = summary.map(r => `
      <div class="stat">
        <div class="n">${money(r.total)}</div>
        <div class="l">${esc(r.courier_name || 'Bilinmeyen')} — ${r.count} teslimat</div>
      </div>`).join('') + `<div class="stat" style="background:var(--s1);color:#06121f"><div class="n">${money(total)}</div><div class="l">Toplam</div></div>`;
  } catch (err) { grid.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

document.addEventListener('click', async (e) => {
  const focusEl = e.target.closest('[data-focus-courier]');
  if (focusEl && !e.target.closest('[data-save-phone],[data-phone-input]')) return focusCourier(focusEl.dataset.focusCourier);
  const btn = e.target.closest('[data-save-phone]');
  if (!btn) return;
  const name = btn.dataset.savePhone;
  const input = document.querySelector(`[data-phone-input="${CSS.escape(name)}"]`);
  try {
    await api('/api/customer/courier-phone', { method: 'POST', body: JSON.stringify({ name, phone: input.value.trim() }) });
    btn.textContent = '✓ Kaydedildi';
    setTimeout(() => { btn.textContent = 'Kaydet'; }, 2000);
  } catch (err) { alert(err.message); }
});

api('/api/customer/summary').then(enterApp).catch(() => {});
