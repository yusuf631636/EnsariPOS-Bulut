/* QR Menü modulu - restoran bilgisayarindaki ajanin ek, TAMAMEN AYRI bir isi.

   TASARIM ILKESI (updater.js ile ayni standart):
   - Kurye senkronizasyonunun 6 saniyelik dongusune HICBIR sekilde dokunmaz;
     kendi seyrek zamanlayicilarini kullanir.
   - HER zamanlayici govdesi bastan sona try/catch icindedir; buradan disari
     yakalanmamis tek bir hata bile cikamaz, surec bu yuzden asla cokmez.
   - config.qrMenuUrl yoksa modul BIR KEZ loglar ve hicbir sey yapmaz - QR Menü
     satin almamis musterilerde davranis sifir degisir.
   - Menu gonderimi ve komut yoklamasi AYRI zamanlayicilardir: tam menu 30
     dakikada bir (agir), komut yoklamasi 30 saniyede bir (cok hafif) - fiyat
     degisikligi kalici WebSocket'e gerek kalmadan ~30 saniyede uygulanir. */
const fs = require('fs');
const path = require('path');
const menuSambapos = require('./menu-sambapos');

const MENU_SYNC_MS = 30 * 60 * 1000;  // tam menu gonderimi: 30 dakikada bir
const MENU_FIRST_DELAY_MS = 60 * 1000; // ilk gonderim: acilistan 60 sn sonra (kurye baglantisi otursun)
const MENU_POLL_MS = 30 * 1000;        // bekleyen fiyat komutlari: 30 saniyede bir
const HTTP_TIMEOUT_MS = 20000;

function log(...args) { console.log(new Date().toISOString(), '[qr-menu]', ...args); }

function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    return fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  } catch { return {}; }
}

let runtimeConfig = null;
function currentConfig() {
  if (!runtimeConfig) runtimeConfig = loadConfig();
  return runtimeConfig;
}
/* qrMenuUrl config.json'da AYRICA belirtilmemisse, zaten var olan
   cloudServerUrl'den otomatik turetilir (ikisi hep ayni sunucuda). Boylece
   musteri QR Menü isteyince restoran bilgisayarina TEKRAR gidip config
   duzenlemeye GEREK KALMAZ - tek yapilmasi gereken, admin panelde o
   musterinin "QR Menü" bayragini acmak; ajan zaten bu adrese konusmaya
   hazir bekliyor, sunucu izin verir vermez calismaya baslar. */
function baseUrl() {
  const explicit = currentConfig().qrMenuUrl;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const cloud = currentConfig().cloudServerUrl;
  return cloud ? `${String(cloud).replace(/\/+$/, '')}/qrmenu` : '';
}
function activationKey() { return currentConfig().activationKey || ''; }

async function post(endpoint, payload) {
  const res = await fetch(`${baseUrl()}/api/agent/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  let data = {};
  try { data = await res.json(); } catch { /* govde bos/bozuk olabilir */ }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* Bekleyen fiyat komutlarini yerel SQL'e uygular ve her birinin sonucunu
   buluta bildirir. Bir komutun hatasi digerlerini DURDURMAZ. */
async function runCommands(commands) {
  if (!Array.isArray(commands) || !commands.length) return;
  for (const command of commands) {
    if (!command || command.action !== 'set-price') continue;
    let result = null, error = null;
    try {
      result = await menuSambapos.updateMenuPrice(command.priceId, command.price);
      log(`fiyat guncellendi: kayit ${command.priceId} ${result.oldPrice} -> ${result.newPrice}`);
    } catch (e) {
      error = e.message;
      log(`fiyat guncellenemedi (kayit ${command.priceId}):`, error);
    }
    try {
      await post('menu-command-result', {
        activationKey: activationKey(),
        id: command.id,
        ok: !error,
        oldPrice: result ? result.oldPrice : null,
        newPrice: result ? result.newPrice : null,
        error
      });
    } catch (e) {
      /* Sonuc bildirilemezse komut bulutta ACIK kalir ve bir sonraki
         yoklamada tekrar gelir - fiyat ayni degere tekrar yazilir, zararsiz. */
      log('komut sonucu bildirilemedi (sonra tekrar denenecek):', e.message);
    }
  }
}

/* Panelde secilen "Kaynak ekran menü" - bulut her push/poll yanitinda
   screenMenuFilter dondurur (undefined = henuz bilinmiyor/auto-detect,
   '' = tum urunler, "Ad" = SADECE o ekran menu). Deger DEGISIRSE (ilk
   ogrenme haric) menu hemen yeniden gonderilir - restoran panelde secim
   yapinca 30 dakika beklemesin. */
let screenMenuOverride;
function applyScreenMenuFilter(value) {
  if (value === undefined) return;
  const changed = screenMenuOverride !== undefined && screenMenuOverride !== value;
  screenMenuOverride = value;
  if (changed) {
    log(`panelden kaynak ekran menü değişti (${value === '' ? 'tüm ürünler' : (value || 'otomatik')}), menü yeniden gönderiliyor.`);
    pushMenu({ source: 'refresh' }).catch(error => log('menü yenileme başarısız (yoksayıldı):', error.message));
  }
}

/* Tam menu gonderimi. HEM zamanlayici HEM de elle tetikleme (Menu-Gonder.bat)
   ayni fonksiyonu cagirir - mantik tek yerdedir. */
async function pushMenu(options) {
  const source = (options && options.source) || 'timer';
  if (!baseUrl()) throw new Error('config.json icinde "qrMenuUrl" yok - QR Menü pasif.');
  if (!activationKey()) throw new Error('config.json icinde "activationKey" yok.');
  const { items, screenMenus, screenMenuMatched } = await menuSambapos.menuItems(screenMenuOverride);
  const response = await post('menu-push', {
    activationKey: activationKey(),
    businessName: currentConfig().businessName || '',
    source,
    items,
    screenMenus,
    screenMenuMatched
  });
  log(`menu gonderildi (${source}): ${items.length} fiyat kaydi, bulut ${response.saved} kayit tuttu.`);
  applyScreenMenuFilter(response.screenMenuFilter);
  await runCommands(response.commands);
  return { sent: items.length, saved: response.saved };
}

async function poll() {
  if (!baseUrl() || !activationKey()) return;
  const response = await post('menu-poll', { activationKey: activationKey() });
  applyScreenMenuFilter(response.screenMenuFilter);
  await runCommands(response.commands);
  if (response.refresh) {
    log('bulut menu yenilemesi istedi.');
    await pushMenu({ source: 'refresh' });
  }
}

function start(config) {
  runtimeConfig = config && typeof config === 'object' ? config : loadConfig();
  if (!baseUrl()) { log('config.json icinde "qrMenuUrl" yok - QR Menü modulu pasif.'); return; }
  if (!activationKey()) { log('config.json icinde "activationKey" yok - QR Menü modulu pasif.'); return; }
  log(`etkin. Menü ${MENU_SYNC_MS / 60000} dakikada bir gonderilecek, komutlar ${MENU_POLL_MS / 1000} saniyede bir yoklanacak.`);

  setTimeout(() => {
    pushMenu({ source: 'ilk' }).catch(error => log('ilk menu gonderimi basarisiz (yoksayildi):', error.message));
    setInterval(() => {
      try { pushMenu({ source: 'timer' }).catch(error => log('menu gonderimi basarisiz (yoksayildi):', error.message)); }
      catch (error) { log('beklenmeyen hata (yoksayildi):', error.message); }
    }, MENU_SYNC_MS);
  }, MENU_FIRST_DELAY_MS);

  setTimeout(() => {
    setInterval(() => {
      try { poll().catch(error => log('yoklama basarisiz (yoksayildi):', error.message)); }
      catch (error) { log('beklenmeyen hata (yoksayildi):', error.message); }
    }, MENU_POLL_MS);
  }, MENU_FIRST_DELAY_MS + 5000);
}

module.exports = { start, pushMenu, poll };
