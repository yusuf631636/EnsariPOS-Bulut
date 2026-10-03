/* Restoran bilgisayarinda calisan TEK surec: SambaPOS'u okuyup buluta
   WebSocket ile baglanir, kurye+siparis verisini gonderir, "teslim edildi"
   komutlarini yerel SQL'e yazar. Web sunucusu YOK, tunele HIC gerek yok -
   sadece disa dogru (outbound) tek bir WebSocket baglantisi acar. */
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const sambapos = require('./sambapos');

const configPath = path.join(__dirname, 'config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const ACTIVATION_KEY = config.activationKey || '';
const CLOUD_URL = (config.cloudServerUrl || 'https://app.ornek-alanadi.com').replace(/^http/, 'ws');
const SYNC_MS = 6000;

if (!ACTIVATION_KEY) { console.error('config.json içinde "activationKey" eksik. Bulut yönetim panelinden alıp girin.'); process.exit(1); }

function log(...args) { console.log(new Date().toISOString(), ...args); }

// Bu ajan tek başına, kritik bir arka plan sürecidir - beklenmeyen bir hatanın
// (menu/guncelleme modulu gibi ek ozelliklerden gelebilecek) tum sureci
// coktermesini engeller; kurye senkronizasyonu bundan etkilenmez.
process.on('uncaughtException', error => log('YAKALANMAMIŞ HATA (yoksayıldı):', error && error.message));
process.on('unhandledRejection', error => log('YAKALANMAMIŞ PROMISE HATASI (yoksayıldı):', error && error.message));

// Otomatik guncelleme: tamamen ayri, seyrek bir zamanlayici - 6 saniyelik
// kurye senkronizasyon dongusune hicbir sekilde dokunmaz. Modul kendi icinde
// tum hatalari yakalar; burasi sadece "hic yuklenemedi" durumuna karsi.
try { require('./updater').start(config); } catch (error) { log('Güncelleme modülü başlatılamadı (yoksayıldı):', error.message); }
try { require('./menu-agent').start(config); } catch (error) { log('Menü modülü başlatılamadı (yoksayıldı):', error.message); }
try { require('./order-agent').start(config); } catch (error) { log('Sipariş modülü başlatılamadı (yoksayıldı):', error.message); }

let ws = null;
let syncTimer = null;
let reconnectDelay = 2000;

async function buildSyncPayload() {
  const [couriers, orders] = await Promise.all([sambapos.couriers(), sambapos.activeCourierOrders()]);
  const withContent = await Promise.all(orders.map(async order => {
    let content = [];
    try { content = await sambapos.orderContent(order.id); } catch { /* icerik alinamadi, bos gec */ }
    return { ...order, content };
  }));
  // Atanmamis paketler TAMAMEN AYRI/izole bir cagri - burasi patlarsa (orn.
  // bu musterinin SambaPOS surumunde farkli bir tablo yapisi varsa) kurye
  // senkronizasyonunun geri kalani (yukaridaki couriers/orders) ETKILENMEZ,
  // sadece bu tek alan bos gider.
  let unassigned = [];
  try { unassigned = await sambapos.unassignedPackages(); } catch (error) { log('Atanmamış paketler alınamadı (yoksayıldı):', error.message); }
  return { couriers, orders: withContent, unassigned };
}

async function sync() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const payload = await buildSyncPayload();
    ws.send(JSON.stringify({ type: 'sync', ...payload }));
  } catch (error) { log('Senkronizasyon hatası:', error.message); }
}

async function handleAction(msg) {
  try {
    if (msg.action === 'delivered') {
      const result = await sambapos.markDelivered(msg.ticketId);
      log(`Sipariş ${msg.ticketId} teslim edildi olarak işaretlendi.`, result);
    }
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', id: msg.id }));
  } catch (error) {
    log(`Komut işlenemedi (sipariş ${msg.ticketId}):`, error.message);
    // Onay gonderilmiyor - bulut, ajan tekrar bagladiginda ayni komutu tekrar gonderir.
  }
}

function connect() {
  const url = `${CLOUD_URL}/agent-ws?activationKey=${encodeURIComponent(ACTIVATION_KEY)}`;
  log('Buluta bağlanılıyor...');
  ws = new WebSocket(url);

  ws.on('open', () => {
    log('Buluta bağlandı.');
    reconnectDelay = 2000;
    sync();
    syncTimer = setInterval(sync, SYNC_MS);
  });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'action') handleAction(msg);
  });
  ws.on('close', () => {
    log('Bulut bağlantısı kesildi, yeniden denenecek.');
    clearInterval(syncTimer);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
  });
  ws.on('error', error => log('Bağlantı hatası:', error.message));
}

connect();
