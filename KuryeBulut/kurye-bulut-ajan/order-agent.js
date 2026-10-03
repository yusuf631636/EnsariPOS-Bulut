/* QR Menü siparis modulu - restoran bilgisayarindaki ajanin ek, TAMAMEN AYRI
   bir isi (menu-agent.js ile AYNI tasarim ilkeleri):
   - Kurye senkronizasyonuna VE menu-agent.js'in zamanlayicilarina HICBIR
     sekilde dokunmaz; kendi ayri zamanlayicisini kullanir.
   - HER zamanlayici govdesi bastan sona try/catch icindedir; buradan disari
     yakalanmamis tek bir hata bile cikamaz, surec bu yuzden asla cokmez.
   - config.json'da sambaAutomationUser/sambaAutomationPassword YOKSA modul
     BIR KEZ loglar ve hicbir sey yapmaz - bu ozelligi kullanmayan/henuz
     SambaPOS Otomasyon kurulumu yapmamis musterilerde davranis SIFIR degisir.
   - Bir siparisin hatasi digerlerini DURDURMAZ (runCommands ile ayni ilke).

   SambaPOS Otomasyon (GraphQL) API'siyle konusur - C:\Online_Site\server.js'teki
   authenticate()/gql()/upsertCustomer()/createTicketOnPOS() mantiginin
   BIREBIR tasinmis hali, tek fark: musteri adresi yerine masa numarasi
   ("Masa" etiketi) kullanilir (QR Menü, teslimat degil MASADA siparis).

   ONEMLI (16.09.2026, bu makinedeki test SambaPOS'ta canli dogrulandi):
   addTicket'a "Durum" state'i ACIKCA "Ödenmedi" olarak GONDERILMEZSE SambaPOS
   adisyonu otomatik olarak "Ödendi" isaretliyor - musteri henuz odemedigi
   icin bu ASLA atlanamaz, aksi halde personel odenmis sanip mutfaga
   gecirmeyebilir. */
const fs = require('fs');
const path = require('path');

const ORDER_POLL_MS = 10 * 1000;         // siparis yoklamasi: 10 saniyede bir (musteri sonucu bekliyor)
const ORDER_FIRST_DELAY_MS = 15 * 1000;  // ilk yoklama: acilistan 15 sn sonra
const HTTP_TIMEOUT_MS = 20000;
const TOKEN_REFRESH_SLACK_MS = 60 * 1000; // suresi dolmadan 1 dk once yenile

function log(...args) { console.log(new Date().toISOString(), '[siparis]', ...args); }

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

/* qrMenuUrl/cloudServerUrl'den turetme mantigi menu-agent.js:baseUrl() ile
   BIREBIR AYNI - siparis uclari da ayni bulut servisinde (qrmenu). */
function cloudBaseUrl() {
  const explicit = currentConfig().qrMenuUrl;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const cloud = currentConfig().cloudServerUrl;
  return cloud ? `${String(cloud).replace(/\/+$/, '')}/qrmenu` : '';
}
function activationKey() { return currentConfig().activationKey || ''; }

/* SambaPOS Otomasyon (GraphQL) baglanti bilgileri - HEPSI ISTEGE BAGLI,
   config.json'da yoksa modul devre disi kalir (bkz. start()). */
function sambaGraphqlUrl() { return String(currentConfig().sambaGraphqlUrl || 'http://localhost:9000').replace(/\/+$/, ''); }
function sambaAutomationUser() { return currentConfig().sambaAutomationUser || ''; }
function sambaAutomationPassword() { return currentConfig().sambaAutomationPassword || ''; }
function sambaAutomationClientId() { return currentConfig().sambaAutomationClientId || 'pda'; }
function sambaAutomationClientSecret() { return currentConfig().sambaAutomationClientSecret || ''; }
function sambaCustomerEntityType() { return currentConfig().sambaCustomerEntityType || 'Müşteriler'; }
function sambaTableEntityType() { return currentConfig().sambaTableEntityType || 'Masalar'; }
/* "masa" (dine-in) ve "paket" (paket servis) siparisleri SambaPOS'ta FARKLI
   adisyon tipi/departman kullanir (Online_Site'daki orijinal kurulumda da
   boyleydi - "Paket Servis" hem tip hem departman adiydi). Ikisi de ayri
   ayri config'den ISTEGE BAGLI ozellestirilir, girilmemisse asagidaki
   varsayilanlara duser (bu makinedeki test SambaPOS'ta dogrulanan degerler). */
function sambaDineInTicketType() { return currentConfig().sambaDineInTicketType || currentConfig().sambaTicketType || 'Adisyon'; }
function sambaDineInDepartment() { return currentConfig().sambaDineInDepartment || currentConfig().sambaDepartment || 'Restoran'; }
function sambaDeliveryTicketType() { return currentConfig().sambaDeliveryTicketType || 'Paket Servis'; }
function sambaDeliveryDepartment() { return currentConfig().sambaDeliveryDepartment || sambaDineInDepartment(); }
function sambaPosUser() { return currentConfig().sambaPosUser || sambaAutomationUser(); }
function sambaPosTerminal() { return currentConfig().sambaPosTerminal || 'Sunucu'; }
/* Masa siparisi acilinca mutfaga otomatik fis yazdirmak icin SambaPOS'ta
   tanimli bir "Yazdirma Gorevi" adi (Yonet > Yazdirma Gorevleri) - BOSSA
   yazdirma hic denenmez (adisyon yine de acilir, sadece otomatik yazdirma
   olmaz - musteri bunu ASLA kaybetmez, sadece personel elle yazdirir). */
function sambaKitchenPrintJob() { return currentConfig().sambaKitchenPrintJob || ''; }

async function post(endpoint, payload) {
  const res = await fetch(`${cloudBaseUrl()}/api/agent/${endpoint}`, {
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

/* ------------------------------------------------- SambaPOS GraphQL ----- */
let cachedToken = null;
let tokenExpiresAt = 0;

async function authenticate() {
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', sambaAutomationUser());
  params.append('password', sambaAutomationPassword());
  params.append('client_id', sambaAutomationClientId());
  params.append('client_secret', sambaAutomationClientSecret());
  params.append('device_id', 'ENSARI_QRMENU_AJAN');

  const res = await fetch(`${sambaGraphqlUrl()}/Token`, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `SambaPOS kimlik doğrulama hatası (HTTP ${res.status})`);
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000 - TOKEN_REFRESH_SLACK_MS;
}

/* Panelde "Sipariş ajanı bağlı mı / SambaPOS bağlantısı çalışıyor mu"
   gostermek icin - HER gql() cagrisinda guncellenir (basarili/basarisiz),
   pollOrders() bunu her yoklamada buluta bildirir (bkz. asagida). Boylece
   SambaPOS Otomasyon bilgileri yanlis girilmisse restoran sahibi ilk gercek
   siparis gelmeden/kaybolmadan ONCE panelde fark edebilir. */
let sambaStatus = { ok: null, error: null };

async function gql(query) {
  try {
    if (!cachedToken || Date.now() >= tokenExpiresAt) await authenticate();

    /* ONEMLI (16.09.2026, bu makinede canli dogrulandi): charset=utf-8 ACIKCA
       belirtilmezse SambaPOS'un eski (OWIN/Web API) JSON ayristiricisi govdeyi
       UTF-8 DISINDA bir kodlamayla okuyor - Turkce karakterler bozuluyor
       ("KARIŞIK" -> "KARIÅIK"), bu da urun/masa adi eslesmesini kirip
       "Menu Item not found" gibi hatalara yol aciyor. */
    const res = await fetch(`${sambaGraphqlUrl()}/api/graphql/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${cachedToken}` },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });

    /* Token suresi erken dolmus/gecersiz kilinmis olabilir - BIR KEZ yeniden
       kimlik dogrulayip tekrar dener (Online_Site'daki ayni desen). */
    if (res.status === 401) {
      cachedToken = null;
      await authenticate();
      return await gql(query);
    }

    const json = await res.json().catch(() => ({}));
    if (json.errors) {
      const message = (json.errors[0] && json.errors[0].message) || 'Bilinmeyen GraphQL hatası';
      throw new Error(message);
    }
    sambaStatus = { ok: true, error: null };
    return json.data;
  } catch (error) {
    sambaStatus = { ok: false, error: error.message };
    throw error;
  }
}

/* GraphQL sorgu/mutasyon metnine giren HER deger buradan gecer - SambaPOS
   tarafinda cift tirnak/backslash sorgunun kendisini bozabilir. */
function gqlString(value) {
  return JSON.stringify(String(value == null ? '' : value));
}

/* Musteri varligini olustur/guncelle - Online_Site:upsertCustomer ile AYNI
   "var mi kontrol et, yoksa ekle, varsa adresi guncelle" mantigi. Musteri adi
   BOSSA (QR Menü'de "Adınız" alani opsiyonel) varlik olusturulmaz - siparis
   entity BAGLANTISI OLMADAN acilir. */
async function upsertCustomer(name, phone, tableNote) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;
  const safePhone = String(phone || '').replace(/\s+/g, '');
  const entityName = `${safeName}-${safePhone || tableNote || '?'}`;

  const existsQuery = `{ isEntityExists(type:${gqlString(sambaCustomerEntityType())}, name:${gqlString(entityName)}) }`;
  const existsRes = await gql(existsQuery);
  if (existsRes && existsRes.isEntityExists) return { name: entityName };

  const addQuery = `mutation {
    addEntity(entity:{
      entityType:${gqlString(sambaCustomerEntityType())},
      name:${gqlString(entityName)},
      customData:[{name:"Müşteri Adı", value:${gqlString(safeName)}}${safePhone ? `,{name:"Telefon", value:${gqlString(safePhone)}}` : ''}]
    }){ name }
  }`;
  await gql(addQuery);
  return { name: entityName };
}

/* Masa siparisinde adisyonu GERCEK "Masalar" varligina baglamaya calisir -
   musteri QR Menü panelinde SENKRONIZE EDILMIS gercek bir isim sectigi icin
   (bkz. pollOrders/sendTableList, public menu sayfasindaki secim kutusu)
   normalde HER ZAMAN bulunur. Yine de bulunamazsa (liste eskimis/degismis
   olabilir) adisyon entity BAGLANTISI OLMADAN acilir - siparis ASLA
   kaybolmaz, sadece masaya otomatik baglanmamis olur. */
async function findTableEntity(tableNote) {
  const name = String(tableNote || '').trim();
  if (!name) return null;
  try {
    const existsRes = await gql(`{ isEntityExists(type:${gqlString(sambaTableEntityType())}, name:${gqlString(name)}) }`);
    return existsRes && existsRes.isEntityExists ? { name } : null;
  } catch (error) {
    log(`masa varlığı sorgulanamadı (adisyon yine de açılacak, bağlantısız):`, error.message);
    return null;
  }
}

/* Masa zaten acik bir adisyona sahipse (garson daha once siparis girmis
   olabilir) QR siparisinin AYRI bir adisyon acmasi YANLIS - ayni masada iki
   adisyon dolasir, hesap karisir (18.09.2026 talebi). Once o masada KAPANMAMIS
   bir adisyon var mi diye bakilir; varsa her kalem TEK TEK addOrderToTicket
   ile o adisyona eklenir. Bu mutasyonun TAM davranisi (ticket'i nasil
   esletirdigi) bu makineden dogrulanamadi - BIR satir bile hata verirse
   TUM siparis icin guvenli yola (createTicketOnPOS - yeni adisyon) DUSULUR,
   boylece yanlis varsayim siparisi ASLA kaybettirmez/yarim birakmaz. */
async function findOpenTicketId(tableEntityName) {
  try {
    const result = await gql(`{ getTickets(isClosed: false, take: 5, entities: [{entityType: ${gqlString(sambaTableEntityType())}, name: ${gqlString(tableEntityName)}}]) { id } }`);
    const list = result && Array.isArray(result.getTickets) ? result.getTickets : [];
    return list.length ? Number(list[0].id) : null;
  } catch (error) {
    log('açık adisyon sorgulanamadı (yeni adisyon açılacak):', error.message);
    return null;
  }
}

async function appendOrdersToExistingTicket(tableEntityName, items) {
  const ticketPart = `{ type:${gqlString(sambaDineInTicketType())}, department:${gqlString(sambaDineInDepartment())}, entities:[{entityType:${gqlString(sambaTableEntityType())}, name:${gqlString(tableEntityName)}}] }`;
  for (const item of items) {
    const quantity = Number(item.quantity) || 1;
    await gql(`mutation { addOrderToTicket(ticket: ${ticketPart}, menuItem: ${gqlString(item.name)}, quantity: ${quantity}, portion: ${gqlString(item.portion || '')}) }`);
  }
}

/* Adisyon olustur. ONEMLI: "Durum" state'i ACIKCA "Ödenmedi" gonderilir -
   yorumdaki 16.09.2026 tarihli notta aciklanan canli dogrulanmis davranis
   (bu state atlanirsa SambaPOS adisyonu otomatik "Ödendi" isaretliyor). */
async function createTicketOnPOS({ ticketType, department, entities, tags, items }) {
  const orders = items.map(item => {
    const quantity = Number(item.quantity) || 1;
    const price = Number(item.price) || 0;
    return `{
      name:${gqlString(item.name)},
      quantity:${quantity},
      price:${price},
      states:[{stateName:"Status", state:"Yeni"}]
    }`;
  }).join(',');

  const entityPart = entities.length ? `entities:[${entities.map(e => `{entityType:${gqlString(e.type)}, name:${gqlString(e.name)}}`).join(',')}],` : '';
  const tagsPart = tags.length ? `tags:[${tags.map(t => `{tagName:${gqlString(t.name)}, tag:${gqlString(t.value)}}`).join(',')}],` : '';

  const mutation = `mutation {
    addTicket(ticket:{
      type:${gqlString(ticketType)},
      department:${gqlString(department)},
      user:${gqlString(sambaPosUser())},
      terminal:${gqlString(sambaPosTerminal())},
      note:${gqlString('QR Menü Siparişi')},
      ${entityPart}
      states:[
        {stateName:"Durum", state:"Ödenmedi"},
        {stateName:"Kaynak", state:"WEB"}
      ],
      ${tagsPart}
      orders:[${orders}]
    }){ id }
  }`;
  const result = await gql(mutation);
  const ticketId = result && result.addTicket && result.addTicket.id;
  if (ticketId === undefined || ticketId === null) throw new Error('Adisyon oluşturuldu ama kayıt numarası alınamadı.');
  return Number(ticketId);
}

/* Mutfak fisi otomatik yazdirma - SADECE masa siparislerinde ve SADECE
   sambaKitchenPrintJob configde tanimliysa denenir. Basarisiz olursa (yanlis
   yazdirma gorevi adi, yazici kapali vb.) SADECE loglanir - adisyon zaten
   acildigi icin siparis KAYBOLMAZ, personel elle yazdirir. */
async function printKitchenJob(ticketId) {
  const jobName = sambaKitchenPrintJob();
  if (!jobName) return;
  try {
    await gql(`mutation { executePrintJob(name:${gqlString(jobName)}, ticketId:${Number(ticketId)}) }`);
  } catch (error) {
    log(`mutfak fişi yazdırılamadı (adisyon ${ticketId}, personel elle yazdırmalı):`, error.message);
  }
}

/* Bulut siparis kaydini SambaPOS'a isler. Musteri adi verilmisse ONCE varlik
   olusturulur/bulunur (basarisiz olursa musteri BAGLANTISIZ devam eder -
   adisyonun kendisi yine de acilsin, "musteri adi kaydedilemedi" yuzunden
   siparis KAYBOLMASIN). Masa/paket serviste FARKLI adisyon tipi/departman
   ve varlik baglama mantigi kullanilir (16.09.2026 talebi). */
async function processOrder(order) {
  const isDineIn = order.orderType !== 'paket';

  let customerEntity = null;
  if (order.customerName) {
    try { customerEntity = await upsertCustomer(order.customerName, order.customerPhone, order.tableNote); }
    catch (error) { log(`müşteri kaydı oluşturulamadı (sipariş ${order.id}, adisyon yine de açılacak):`, error.message); }
  }

  const entities = [];
  const tags = [];
  let tableEntity = null;
  if (isDineIn) {
    tableEntity = await findTableEntity(order.tableNote);
    if (tableEntity) entities.push({ type: sambaTableEntityType(), name: tableEntity.name });
    else tags.push({ name: 'Masa', value: order.tableNote });
  } else {
    /* Paket servis: Online_Site'daki orijinal akisla AYNI bilgiler - adres,
       telefon, odeme turu - hepsi etiket olarak adisyona islenir (musteri
       entity'sinde de ayrica saklanir, bkz. upsertCustomer). */
    if (order.tableNote) tags.push({ name: 'Adres', value: order.tableNote });
    if (order.customerPhone) tags.push({ name: 'Telefon', value: order.customerPhone });
    tags.push({ name: 'Ödeme Türü', value: order.paymentType === 'kart' ? 'Kredi Kartı' : 'Nakit' });
  }
  if (customerEntity) entities.push({ type: sambaCustomerEntityType(), name: customerEntity.name });

  /* Masa zaten acik bir adisyona sahipse ürünleri ONA ekle (18.09.2026 talebi:
     "masa zaten açıksa yeni adisyon açılmayacak, mevcut adisyona ürünleri
     ekle") - guvenli deneme: basarisiz olursa (yanlis varsayim/SambaPOS
     surumu farki) NORMAL yeni-adisyon yoluna duser, siparis ASLA kaybolmaz. */
  if (isDineIn && tableEntity) {
    const openTicketId = await findOpenTicketId(tableEntity.name);
    if (openTicketId) {
      try {
        await appendOrdersToExistingTicket(tableEntity.name, order.items);
        log(`sipariş mevcut açık adisyona eklendi: masa ${tableEntity.name} -> adisyon ${openTicketId}`);
        await printKitchenJob(openTicketId);
        return String(openTicketId);
      } catch (error) {
        log(`mevcut adisyona ekleme başarısız (yeni adisyon açılacak, masa ${tableEntity.name}):`, error.message);
      }
    }
  }

  const ticketId = await createTicketOnPOS({
    ticketType: isDineIn ? sambaDineInTicketType() : sambaDeliveryTicketType(),
    department: isDineIn ? sambaDineInDepartment() : sambaDeliveryDepartment(),
    entities,
    tags,
    items: order.items
  });

  if (isDineIn) await printKitchenJob(ticketId);
  return String(ticketId);
}

/* Musteri sayfasindaki masa secim kutusunu (routes/public.js:publicMenu ->
   tables) dolduran gercek Masalar listesi - HER yoklamada degil, ~1 dakikada
   bir (6 poll dongusunde bir) cekilir, SambaPOS'a gereksiz yuk binmesin. */
let tableSyncCounter = 0;
async function currentTableNames() {
  try {
    const result = await gql(`{ getEntities(type:${gqlString(sambaTableEntityType())}, take: 500) { name } }`);
    const list = result && Array.isArray(result.getEntities) ? result.getEntities : [];
    return list.map(e => e.name).filter(Boolean);
  } catch (error) {
    log('masa listesi alınamadı (yoksayıldı):', error.message);
    return null;
  }
}

/* ------------------------------------------------------- kuyruk/yoklama --- */
async function pollOrders() {
  if (!cloudBaseUrl() || !activationKey()) return;
  if (!sambaAutomationUser() || !sambaAutomationPassword()) return;

  const payload = { activationKey: activationKey() };
  tableSyncCounter++;
  if (tableSyncCounter % 6 === 1) {
    const tables = await currentTableNames();
    if (tables) payload.tables = tables;
  }
  payload.sambaOk = sambaStatus.ok;
  payload.sambaError = sambaStatus.error;

  const response = await post('order-poll', payload);
  const orders = Array.isArray(response.orders) ? response.orders : [];
  for (const order of orders) {
    let ticketId = null, error = null;
    try {
      ticketId = await processOrder(order);
      log(`sipariş işlendi: kayıt ${order.id} -> adisyon ${ticketId}`);
    } catch (e) {
      error = e.message;
      log(`sipariş işlenemedi (kayıt ${order.id}):`, error);
    }
    try {
      await post('order-result', { activationKey: activationKey(), id: order.id, ok: !error, ticketId, error });
    } catch (e) {
      /* Sonuc bildirilemezse siparis bulutta ACIK kalir ve bir sonraki
         yoklamada TEKRAR gelir - ayni adisyon TEKRAR acilabilir (menu-agent.js
         fiyat komutlarindaki gibi "zararsiz tekrar" degil, burada CIFT
         ADISYON riski var). Bu yuzden HER siparis islenir islenmez hemen
         bildirilir - araya baska bir siparis islemi GIRMEZ. */
      log(`sipariş sonucu bildirilemedi (kayıt ${order.id}, sonra tekrar denenecek - AYNI adisyon TEKRAR acilabilir, dikkat):`, e.message);
    }
  }
}

function start(config) {
  runtimeConfig = config && typeof config === 'object' ? config : loadConfig();
  if (!cloudBaseUrl()) { log('config.json içinde "qrMenuUrl" yok - sipariş modülü pasif.'); return; }
  if (!activationKey()) { log('config.json içinde "activationKey" yok - sipariş modülü pasif.'); return; }
  if (!sambaAutomationUser() || !sambaAutomationPassword()) {
    log('config.json içinde "sambaAutomationUser"/"sambaAutomationPassword" yok - sipariş modülü pasif (QR Menü sadece görüntüleme modunda çalışmaya devam eder).');
    return;
  }
  log(`etkin. Siparişler ${ORDER_POLL_MS / 1000} saniyede bir yoklanacak (SambaPOS: ${sambaGraphqlUrl()}, masa: ${sambaDineInTicketType()}/${sambaDineInDepartment()}, paket: ${sambaDeliveryTicketType()}/${sambaDeliveryDepartment()}).`);

  setTimeout(() => {
    setInterval(() => {
      try { pollOrders().catch(error => log('sipariş yoklaması başarısız (yoksayıldı):', error.message)); }
      catch (error) { log('beklenmeyen hata (yoksayıldı):', error.message); }
    }, ORDER_POLL_MS);
  }, ORDER_FIRST_DELAY_MS);
}

module.exports = { start, pollOrders };
