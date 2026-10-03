/* Kurye Yonetimi paneli (kuryebulut.ornek-alanadi.com/restoran).
   customer/app.js'in SADECE kurye ile ilgili parcalarinin bagimsiz kopyasi.
   Burada BILEREK YOK: loadSummary()/renderSnapshot(), loadPatronReport(),
   loadPatronMenuSearch()/fiyat gonderme, QR Menu, ve HOST_VIEWS/applyHostView()
   (hostname'e gore gizleme mekanizmasi) - gizlenecek bir sey kalmadigi icin
   gerek de yok. Ayni backend uc noktalari, ayni giris, ayni cerez.
   money() ortak /snapshot.js dosyasindan gelir (bkz. index.html). */
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

let pollTimer = null;
function enterApp() {
  loginView.hidden = true;
  appView.hidden = false;
  document.getElementById('reportDate').value = new Date().toISOString().slice(0, 10);
  loadBizName();
  refreshAll();
  loadReport();
  pollTimer = setInterval(refreshAll, 20000);
}
function refreshAll() { loadCouriers(); loadLocations(); loadTodayStats(); loadUnassigned(); }

/* Henuz kuryeye atanmamis paketler - restoran sahibi bunlari gorup SambaPOS'ta
   ilgili kuryeye atamasi gerektigini bilsin diye ayri, dikkat cekici bir kart. */
async function loadUnassigned() {
  try {
    const { orders } = await api('/api/customer/unassigned-orders');
    const card = document.getElementById('unassignedCard');
    card.hidden = orders.length === 0;
    document.getElementById('unassignedList').innerHTML = orders.map(o => `
      <div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)">
        <span>${esc(o.customerName)}${o.address ? ' · ' + esc(o.address) : ''}<br><span class="muted">Fiş ${esc(o.number)}</span></span>
        <span>${money(o.total)}</span>
      </div>`).join('');
  } catch { /* sessizce gec */ }
}
document.getElementById('reportDate').addEventListener('change', loadReport);

/* Ust cubuktaki isletme adi. /api/customer/summary'nin SADECE businessName
   alani kullanilir - Patron Raporu ozeti (data) bu panelde hic cizilmez.
   Bir kez cagrilir, 20 sn'lik dongude tekrarlanmaz. */
async function loadBizName() {
  try {
    const { businessName } = await api('/api/customer/summary');
    document.getElementById('bizName').textContent = businessName ? `${businessName} — Kurye Yönetimi` : 'Kurye Yönetimi';
  } catch { /* isim gelmezse baslik sabit kalir */ }
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

/* Kurye karti = kuryeler + aktif siparisler tek bir listede birlesir - "hangi
   pakectide ne kadar tutar var" tek bakista gorunsun diye. Tutar,
   /api/customer/orders'taki (kuryeye atanmis) aktif siparislerin toplamidir. */
async function loadCouriers() {
  try {
    const [{ couriers }, { orders }] = await Promise.all([
      api('/api/customer/couriers'),
      api('/api/customer/orders')
    ]);
    const byCourier = {};
    orders.forEach(o => {
      const bucket = byCourier[o.courierName] || (byCourier[o.courierName] = { total: 0, enrouteTotal: 0 });
      bucket.total += Number(o.total) || 0;
      if (o.packageStatus === 'Yolda') bucket.enrouteTotal += Number(o.total) || 0;
    });
    document.getElementById('courierList').innerHTML = couriers.length ? couriers.map(c => {
      const amounts = byCourier[c.name] || { total: 0, enrouteTotal: 0 };
      const active = c.pending + c.enroute > 0;
      return `
      <div class="card" style="background:var(--surface-2);margin-bottom:10px${active ? ';border-color:var(--s1)' : ''}">
        <div class="row" data-focus-courier="${esc(c.name)}" style="margin-bottom:8px;cursor:pointer">
          <b>${esc(c.name)}</b>
          <span style="font-weight:700;font-size:16px">${money(amounts.total)}</span>
        </div>
        <div class="row" style="margin-bottom:8px">
          <span class="muted">${c.pending} bekliyor · ${c.enroute} yolda (yoldaki tutar: ${money(amounts.enrouteTotal)})</span>
        </div>
        <div class="badge active" style="margin-bottom:8px">🔑 PIN: ${esc(c.pin)}</div>
        <input type="tel" placeholder="Telefon (05XX XXX XX XX)" value="${esc(c.phone)}" data-phone-input="${esc(c.name)}" style="margin-bottom:8px">
        <button class="btn small" data-save-phone="${esc(c.name)}">Kaydet</button>
      </div>`;
    }).join('') : '<p class="muted">Henüz kurye verisi gelmedi.</p>';
    document.getElementById('orderCount').textContent = orders.length ? `(toplam ${orders.length} aktif sipariş)` : '';
  } catch { /* sessizce gec */ }
}

/* Kurye kartina basilinca haritadaki ilgili isaretciye kayar ve konum
   balonunu acar - konumu yoksa bilgi verir. Bu panelde sekme YOK, o yuzden
   musteri panelindeki "Harita sekmesine tikla" yerine harita kartina kaydirilir. */
function focusCourier(name) {
  const marker = markers.get(name);
  if (!marker) { alert(`${name} henüz konum paylaşmıyor.`); return; }
  document.getElementById('mapCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

/* Acilista oturum kontrolu - cerez gecerliyse dogrudan panele girilir. */
api('/api/customer/summary').then(enterApp).catch(() => {});
