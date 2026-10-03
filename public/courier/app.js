const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(Number(value) || 0);
const mapsUrl = address => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

let knownIds = new Set();
let hasRenderedOnce = false; // ilk yuklemede mevcut siparisleri "yeni" gibi seslendirmemek icin
let pollTimer = null;

/* Servis calisani kaydi - "Ana ekrana ekle / Uygulama olarak yukle" istemi
   (beforeinstallprompt) icin Chrome bunu gerekli sayabiliyor. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/courier/sw.js').catch(() => {}));
}

function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeToggle').textContent = theme === 'light' ? '☀️' : '🌙';
  try { localStorage.setItem('kurye-theme', theme); } catch { /* gizli gezinti modu olabilir */ }
}
try { setTheme(localStorage.getItem('kurye-theme') || 'dark'); } catch { setTheme('dark'); }
$('themeToggle').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

/* Sesli konusma ("Siparişiniz var") cogu telefonda/hoparlorde zayif/kisik
   cikiyor - bunun yaninda Web Audio ile ureteceğimiz, sesi kendimiz
   ayarladigimiz (tam guc, gain=1) net ve YUKSEK iki "bip" sesi calariz.
   Bu, cihazin/tarayicinin konusma motorunun sessine bagli kalmadigi icin
   her zaman ayni yuksekllikte, dikkat cekici bir uyari verir. */
let audioCtx = null;
function unlockAudioAlert() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* Web Audio desteklenmiyor olabilir */ }
}
function playAlertTone() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [0, 0.32].forEach(offset => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square'; // sine'dan daha keskin/dikkat cekici
      osc.frequency.value = 1046.5; // C6 - net, tiz bir bip
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.3);
    });
  } catch { /* sessizce gec */ }
}

/* Yeni sipariş atandığında sesli uyarı: yuksek "bip bip" + "Siparişiniz var"
   konusmasi + titresim (uygulama açıkken calisir). */
function announceNewOrder() {
  playAlertTone();
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance('Siparişiniz var');
    utter.lang = 'tr-TR';
    utter.volume = 1;
    speechSynthesis.speak(utter);
  } catch { /* Speech API desteklenmiyor olabilir */ }
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
}

async function api(path, options) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options && options.headers) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Sunucu hatası.');
  return data;
}

function badgeClass(status) { return status === 'Yolda' ? 'yolda' : 'bekliyor'; }

function renderOrders(orders) {
  const host = $('orders');
  $('empty').hidden = orders.length > 0;
  const currentIds = new Set(orders.map(o => o.id));
  const isNewOrder = hasRenderedOnce && [...currentIds].some(id => !knownIds.has(id));
  if (isNewOrder) announceNewOrder();
  hasRenderedOnce = true;
  host.innerHTML = orders.map(order => `
    <div class="order${knownIds.has(order.id) ? '' : ' new'}" data-id="${esc(order.id)}">
      <div class="order-top">
        <span class="num">Fiş ${esc(order.number)}</span>
        <span class="amount">${money(order.total)}</span>
      </div>
      <div class="order-name">${esc(order.customerName)}</div>
      ${order.address ? `<div class="order-address">${esc(order.address)}</div>` : ''}
      <div class="order-meta">
        <span class="badge ${badgeClass(order.packageStatus)}">${esc(order.packageStatus || 'Bekliyor')}</span>
      </div>
      <div class="actions">
        ${order.phone ? `<a href="tel:${esc(order.phone)}">📞 Ara</a>` : '<span class="unavailable">📞 Numara yok</span>'}
        ${order.address ? `<a href="${esc(mapsUrl(order.address))}" target="_blank" rel="noopener">🗺️ Yol tarifi</a>` : '<span class="unavailable">🗺️ Adres yok</span>'}
      </div>
      <button class="content-toggle" data-content="${esc(order.id)}">Sipariş içeriğini göster</button>
      <button class="deliver-btn" data-deliver="${esc(order.id)}">✓ Teslim Edildi</button>
    </div>
  `).join('');
  knownIds = currentIds;
}

async function showContent(id) {
  $('detailBody').innerHTML = '<p class="muted">Yükleniyor…</p>';
  $('detailSheet').hidden = false;
  try {
    const data = await api(`/api/courier/order-content?id=${encodeURIComponent(id)}`);
    $('detailBody').innerHTML = data.items.length
      ? data.items.map(item => `<div class="content-row"><span><span class="qty">${esc(item.quantity)}x</span>${esc(item.name)}</span><span>${esc(money(item.price * item.quantity))}</span></div>`).join('')
      : '<p class="muted">Ürün bulunamadı.</p>';
  } catch (error) { $('detailBody').innerHTML = `<p class="err">${esc(error.message)}</p>`; }
}

async function markDelivered(id, button) {
  if (!confirm('Teslim edildi ve ödeme alındı olarak işaretlensin mi?\nAdisyon kapatılacak.')) return;
  button.disabled = true; button.textContent = 'Kaydediliyor…';
  try {
    await api(`/api/courier/deliver?id=${encodeURIComponent(id)}`, { method: 'POST' });
    alert('✓ Teslim edildi olarak işaretlendi.\nRestoranın bilgisayarına birkaç saniye içinde yansıyacak.');
    loadOrders();
  } catch (error) {
    alert(error.message);
    button.disabled = false; button.textContent = '✓ Teslim Edildi';
  }
}

async function loadOrders() {
  try {
    const data = await api('/api/courier/orders');
    if (data.courierName) $('courierName').textContent = data.courierName;
    renderOrders(data.orders);
  } catch { /* baglanti gecici kesilmis olabilir, bir sonraki pollde duzelir */ }
}

/* Kurye izin verdigi surece konumu ~15 saniyede bir sunucuya gonderir -
   restoran sahibi musteri panelindeki haritada canli gorur. */
let watchId = null;
function startLocationSharing() {
  if (!('geolocation' in navigator) || watchId !== null) return;
  let lastSent = 0;
  watchId = navigator.geolocation.watchPosition(
    position => {
      const now = Date.now();
      if (now - lastSent < 15000) return;
      lastSent = now;
      api('/api/courier/location', { method: 'POST', body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }) }).catch(() => {});
    },
    () => { /* izin reddedildi/hata - sessizce devam, konum paylasilmadan da uygulama calisir */ },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

/* Ekranin kilitlenip yoklama/konum zamanlayicilarinin uykuya gecmesini
   geciktirir - tarayici izin verdigi surece ekran acik kalir. Kullanici
   ekranin kilitlenmesini tamamen engelleyemeyiz (isletim sistemi
   kisitlamasi), ama uygulama on planda oldugu surece bu calisir. */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* desteklenmiyor veya izin yok - sessizce gec */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    // Telefon kilitliyken/uygulama arka plandayken zamanlayicilar
    // durdurulmus olabilir - geri donuldugunde hemen guncelle.
    if (!$('mainView').hidden) { loadOrders(); }
  }
});

function enterMain(courierName) {
  $('loginView').hidden = true;
  $('mainView').hidden = false;
  $('courierName').textContent = courierName;
  $('connDot').classList.remove('off');
  loadOrders();
  pollTimer = setInterval(loadOrders, 6000);
  startLocationSharing();
  requestWakeLock();
}

/* Cogu mobil tarayici, sesli uyariyi (speechSynthesis) yalnizca gercek bir
   kullanici dokunusu icinde ilk kez calistirilirsa sonraki cagrilarda (orn.
   6 saniyelik yoklama zamanlayicisindan) sessizce izin veriyor - bu izni
   giris butonuna basarken (gercek dokunus aninda) burada "kilidini aciyoruz",
   yoksa yeni siparis geldiginde sesli uyari calmiyordu (bildirilen hataydi). */
function unlockSpeech() {
  try {
    const utter = new SpeechSynthesisUtterance('');
    utter.volume = 0;
    speechSynthesis.speak(utter);
  } catch { /* Speech API desteklenmiyor olabilir */ }
  unlockAudioAlert();
}
/* Oturum kalici oldugu icin (bkz. asagidaki otomatik giris kontrolu) kullanici
   cogu zaman giris butonuna hic basmadan direkt ana ekrana geciyor - bu yuzden
   kilidi sadece giris butonuna degil, sayfadaki ILK dokunusa da bagliyoruz. */
document.addEventListener('pointerdown', unlockSpeech, { once: true });

/* Giris bilgileri (isletme + PIN) telefonda saklanir - oturum cerezi
   suresi dolsa bile (uzun sure uygulamayi acmazsa) tekrar elle yazmasina
   gerek kalmadan otomatik giris yapilir. Cikis yapinca silinir. */
const CREDS_KEY = 'kurye-bulut-creds';
function saveCreds(business, pin) { try { localStorage.setItem(CREDS_KEY, JSON.stringify({ business, pin })); } catch {} }
function loadCreds() { try { return JSON.parse(localStorage.getItem(CREDS_KEY) || 'null'); } catch { return null; } }
function clearCreds() { try { localStorage.removeItem(CREDS_KEY); } catch {} }

async function doLogin(business, pin) {
  const data = await api('/api/courier/login', { method: 'POST', body: JSON.stringify({ business, pin }) });
  saveCreds(business, pin);
  enterMain(data.courierName);
}

$('loginBtn').onclick = async () => {
  unlockSpeech();
  const business = $('business').value.trim();
  const pin = $('pin').value.trim();
  const err = $('loginErr');
  err.hidden = true;
  if (!business || !pin) return;
  $('loginBtn').disabled = true;
  try {
    await doLogin(business, pin);
  } catch (error) { err.textContent = error.message; err.hidden = false; }
  finally { $('loginBtn').disabled = false; }
};
$('pin').addEventListener('keydown', event => { if (event.key === 'Enter') $('loginBtn').click(); });
$('logoutBtn').onclick = async () => { clearInterval(pollTimer); clearCreds(); await api('/api/courier/logout', { method: 'POST' }); location.reload(); };
$('closeDetail').onclick = () => { $('detailSheet').hidden = true; };
document.addEventListener('click', event => {
  const contentBtn = event.target.closest('[data-content]');
  if (contentBtn) return showContent(contentBtn.dataset.content);
  const deliverBtn = event.target.closest('[data-deliver]');
  if (deliverBtn) return markDelivered(deliverBtn.dataset.deliver, deliverBtn);
});

// Zaten oturum acik mi diye sessizce dene; degilse, telefonda saklanmis
// giris bilgisi varsa onunla otomatik giris dene - kullaniciya hic
// giris ekrani gostermeden.
api('/api/courier/orders').then(data => enterMain(data.courierName || '')).catch(async () => {
  const creds = loadCreds();
  if (!creds) return;
  try { await doLogin(creds.business, creds.pin); } catch { clearCreds(); }
});
