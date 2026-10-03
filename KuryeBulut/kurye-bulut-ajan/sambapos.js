/* SambaPOS ile ilgili tum SQL okuma/yazma islemleri burada toplanir.
   Sema gercekleri (Faz 1 kesfinde dogrulandi):
   - Kuryeler: Entities, EntityTypeId=3 ("Paketciler"), CustomData=[{Telefon},{Sifresi},{PIN},{Durum}]
   - Siparis-kurye eslesmesi: Tickets.TicketStates JSON dizisinde SN="Paketci Adi" (deger=kurye Entity.Name)
     ve SN="Paket" (deger=Bekliyor/Yolda/Teslim Edildi). Her elemanin D (tarih) alani da var.
   - Musteri bilgisi: TicketEntities -> Entities (EntityTypeId IN musteri tipleri), CustomData=[{Adres},{Musteri Adi}]. */
const { sql, rows } = require('./sql');

/* sqlcmd varsayilan sutun genisligi 256 karakterle sinirlidir; TicketStates JSON'u
   bundan uzun olabildigi icin -y 0 (sinirsiz) ile cagiriyoruz. */
function sqlWide(query) { return sql(query, { wide: true }); }

const COURIER_ENTITY_TYPE = 3;
/* Online siparis/musteri entegrasyonlarinin EntityTypeId'leri (YS/Getir/Trendyol/Migros/Musteriler). */
const CUSTOMER_ENTITY_TYPES = '1,4,6,8,22';

function parseCustomData(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Object.fromEntries(arr.filter(item => item && item.Name).map(item => [item.Name, item.Value]));
  } catch { return {}; }
}
/* Paket durumu (SN="Paket") ve kurye atama tarihi (SN="Paketçi Adı") artik
   SQL tarafinda JSON_VALUE/OPENJSON/ISJSON ile DEGIL, burada JS tarafinda
   ayristiriliyor. Sebep: bu fonksiyonlar SQL Server'da veritabani uyumluluk
   duzeyi (compatibility level) 130'un ALTINDAYSA (eski/tasinmis bir
   veritabaninda sik rastlanir - sunucu motoru guncel olsa bile) "not a
   recognized built-in function name" hatasi verip TUM sorguyu patlatiyordu;
   bu da gercek siparis yerine sqlcmd'nin hata metnini "satir" sanip
   courier_orders tablosuna col cop veri yaziyordu. JSON.parse ise SQL
   Server surumunden bagimsiz calisir, HER musteride guvenlidir. */
function parseTicketStates(json) {
  let arr; try { arr = JSON.parse(json || '[]'); } catch { return { packageStatus: '', assignedAt: '' }; }
  if (!Array.isArray(arr)) return { packageStatus: '', assignedAt: '' };
  const find = sn => arr.find(item => item && item.SN === sn);
  const paket = find('Paket');
  const paketci = find('Paketçi Adı');
  return { packageStatus: (paket && paket.S) || '', assignedAt: (paketci && paketci.D) || '' };
}
function parseNetDate(value) {
  const match = String(value || '').match(/\/Date\((\d+)([+-]\d+)?\)\//);
  return match ? new Date(Number(match[1])) : null;
}
function parsePhoneFromName(name) {
  const match = String(name || '').match(/(\d{10,11})\s*$/);
  return match ? match[1] : '';
}

/* Kurye listesi: Users'tan (SambaPOS'taki gercek giris PIN'i, "Paketciler" rolu).
   Telefon numarasi artik bulutta (musteri paneli uzerinden) tutuluyor - ajan
   sadece isim+PIN gonderir, bulut PIN'i courier_pins'e yazip giris dogrulamasini
   kendisi yapar (SambaPOS'a hicbir zaman dogrudan disaridan erisilmez). */
async function couriers() {
  /* ONEMLI: UserRoles.Id sabit degildir - her restoran kendi rollerini kendi
     sirasiyla olusturdugu icin "Paketciler" rolunun Id'si kurulumdan kuruluma
     FARKLI olur (bir musteride 3, baskasinda 5, 7 vs. olabilir). Eskiden burada
     sabit UserRole_Id=3 varsayiliyordu - bu ID farkli bir role denk gelen
     musterilerde (orn. yeni kurulan restoranlar) kurye listesi/PIN'leri hic
     gelmiyordu. Artik role Id'sine degil, rol ADINA gore (paket/kurye gecen
     herhangi bir rol) dinamik eslesiyoruz - hangi ID'ye sahip olursa olsun calisir. */
  const userQuery = `SET NOCOUNT ON; SELECT u.Id, u.Name, u.PinCode FROM Users u JOIN UserRoles r ON r.Id = u.UserRole_Id WHERE r.Name LIKE '%paket%' OR r.Name LIKE '%kurye%' OR r.Name LIKE '%courier%' ORDER BY u.Name;`;
  const users = rows(await sqlWide(userQuery), ['id', 'name', 'pin']);
  /* ONEMLI: burada isim desenine gore filtreleme YAPILMAZ. Bu ajan farkli
     musterilere kuruluyor ve her restoran kuryelerini kendi istedigi gibi
     adlandiriyor ("Paketci-1" formatinda olmayabilir - "Ahmet", "Kurye1",
     "Mehmet Usta" vb. de olabilir). Eskiden burada sadece "Paketci-N" desenine
     uyanlar aliniyordu (tek bir restoran icin dogruydu) - baska isimlendirme
     kullanan bir musteride kurye listesi tamamen bos donuyordu. Artik
     "Paketciler" rolune atanmis HERKES kurye sayilir; restoran sahibi hangi
     kullaniciyi bu role atadiysa ona guveniyoruz. */
  return users.map(user => ({ id: user.id, name: user.name, pin: user.pin }));
}

/* Acik (IsClosed=0) ve bir kuryeye atanmis (Paketci Adi seti) tum siparisler. */
async function activeCourierOrders() {
  const query = `SET NOCOUNT ON;
    SELECT
      t.Id, COALESCE(t.TicketNumber,''), CONVERT(varchar(19),t.Date,120), COALESCE(t.TotalAmount,0),
      COALESCE(t.TicketStates,''),
      COALESCE(cur.Name,''),
      COALESCE(cust.Name,''), COALESCE(cust.CustomData,'')
    FROM Tickets t
    /* Kurye atamasi SambaPOS'un kendi rapor motorunun ("Paketçi Raporu") da kullandigi
       TicketEntities baglantisidir (EntityTypeId=3, ad/tip dogrudan bu tabloda tutulur,
       Entities'e JOIN gerekmez) - TicketStates JSON yerine bunu birincil kaynak aliyoruz. */
    OUTER APPLY (SELECT TOP 1 EntityName AS Name FROM TicketEntities WHERE Ticket_Id=t.Id AND EntityTypeId=${COURIER_ENTITY_TYPE} ORDER BY Id DESC) cur
    OUTER APPLY (SELECT TOP 1 EntityName AS Name, EntityCustomData AS CustomData FROM TicketEntities WHERE Ticket_Id=t.Id AND EntityTypeId IN (${CUSTOMER_ENTITY_TYPES}) ORDER BY Id DESC) cust
    WHERE t.IsClosed=0 AND cur.Name IS NOT NULL AND cur.Name <> ''
    ORDER BY t.Date DESC;`;
  const text = await sqlWide(query);
  return rows(text, ['id', 'number', 'date', 'total', 'ticketStates', 'courierName', 'customerEntity', 'customerData'])
    .map(row => {
      const customer = parseCustomData(row.customerData);
      const { packageStatus, assignedAt } = parseTicketStates(row.ticketStates);
      return {
        id: row.id,
        number: row.number,
        date: row.date,
        total: +row.total,
        packageStatus,
        courierName: row.courierName,
        assignedAt: parseNetDate(assignedAt),
        customerName: customer['Müşteri Adı'] || row.customerEntity || 'Bilinmeyen',
        address: customer['Adres'] || '',
        phone: parsePhoneFromName(row.customerEntity)
      };
    });
}

/* Acik ama HENUZ HICBIR KURYEYE atanmamis paket/paket-tipi siparisler -
   activeCourierOrders()'a HIC DOKUNMADAN, tamamen AYRI/ek bir sorgu (o
   fonksiyon zaten canli/kanitlanmis, riske atilmiyor). "Bu bir paket mi"
   sorusu burada kurye atamasindan turetilemez (tanimi geregi hicbiri yok),
   o yuzden C:\ensari\server.js'nin openTables()'ta zaten kullandigi ayni
   kanitlanmis sezgisellik (adisyon tipi adi / online siparis kullanicisi)
   kullanilir. */
async function unassignedPackages() {
  const query = `SET NOCOUNT ON;
    SELECT
      t.Id, COALESCE(t.TicketNumber,''), CONVERT(varchar(19),t.Date,120), COALESCE(t.TotalAmount,0),
      COALESCE(cust.Name,''), COALESCE(cust.CustomData,'')
    FROM Tickets t
    LEFT JOIN TicketTypes tt ON tt.Id=t.TicketTypeId
    OUTER APPLY (SELECT TOP 1 EntityName AS Name, EntityCustomData AS CustomData FROM TicketEntities WHERE Ticket_Id=t.Id AND EntityTypeId IN (${CUSTOMER_ENTITY_TYPES}) ORDER BY Id DESC) cust
    WHERE t.IsClosed=0
      AND NOT EXISTS (SELECT 1 FROM TicketEntities te2 WHERE te2.Ticket_Id=t.Id AND te2.EntityTypeId=${COURIER_ENTITY_TYPE})
      AND (LOWER(COALESCE(tt.Name,'')) LIKE '%paket%' OR LOWER(COALESCE(tt.Name,'')) LIKE '%takeaway%' OR LOWER(COALESCE(t.CreatedUserName,'')) IN ('yemek sepeti','trendyol','getir'))
    ORDER BY t.Date DESC;`;
  const text = await sqlWide(query);
  return rows(text, ['id', 'number', 'date', 'total', 'customerEntity', 'customerData'])
    .map(row => {
      const customer = parseCustomData(row.customerData);
      return {
        id: row.id,
        number: row.number,
        date: row.date,
        total: +row.total,
        customerName: customer['Müşteri Adı'] || row.customerEntity || 'Bilinmeyen',
        address: customer['Adres'] || '',
        phone: parsePhoneFromName(row.customerEntity)
      };
    });
}

async function orderContent(ticketId) {
  if (!/^\d+$/.test(String(ticketId))) throw new Error('Geçersiz sipariş numarası.');
  const query = `SET NOCOUNT ON; SELECT COALESCE(NULLIF(o.MenuItemName,''),'Bilinmeyen'),COALESCE(o.Quantity,0),COALESCE(o.Price,0) FROM Orders o WHERE o.TicketId=${Number(ticketId)} ORDER BY o.OrderNumber,o.Id;`;
  return rows(await sql(query), ['name', 'quantity', 'price']).map(row => ({ ...row, quantity: +row.quantity, price: +row.price }));
}

/* SambaPOS'un kapali biletlerinde gozlenen sabit degerler (DepartmentId/UserId/TerminalId/
   ExchangeRate hep ayni); Payments_insert_trigger sadece senkronizasyon takibi yapiyor,
   muhasebeyle ilgili degil - guvenle INSERT edilebilir (dogrulandi). */
const PAYMENT_TYPE_CASH = 1; // Nakit
const PAYMENT_DEPARTMENT_ID = 1, PAYMENT_USER_ID = 1, PAYMENT_TERMINAL_ID = 1;

/* Simdiki zamani SambaPOS'un kendi state'lerinde kullandigi .NET JSON tarih formatiyla uretir. */
function netDateNow() { return `/Date(${Date.now()}+0300)/`; }
/* states dizisinde SN'si verilen elemani S=value ile gunceller; yoksa yeni eleman ekler
   (SambaPOS'un normal akista urettigi elemanlarla ayni sekilde: D/S/SN/SV). */
function upsertState(states, sn, value) {
  const idx = states.findIndex(item => item && item.SN === sn);
  if (idx === -1) { states.push({ D: netDateNow(), S: value, SN: sn, SV: '' }); }
  else { states[idx] = { ...states[idx], D: netDateNow(), S: value }; }
}

/* Kurye "Teslim edildi" dedigi anda: (1) kalan tutar kadar Nakit tahsilat kaydi acar,
   (2) adisyonu kapatir, (3) SambaPOS'un kendi Paket VE Durum state'lerini gunceller.
   Not: sadece "Paket" state'ini guncellemek yetmiyor - SambaPOS'un arayuzu "Durum"
   state'ine (Odendi/Odenmedi) gore "acik/kapali" gosterimi yapiyor; bu dogrulandi
   (17312/17306 test edildi: veritabaninda IsClosed=1 olmasina ragmen Durum="Odenmedi"
   kaldigi icin SambaPOS ekraninda hala acik/odenmemis gorunuyordu). */
async function markDelivered(ticketId) {
  if (!/^\d+$/.test(String(ticketId))) throw new Error('Geçersiz sipariş numarası.');
  const id = Number(ticketId);
  const row = rows(await sqlWide(`SET NOCOUNT ON; SELECT TicketStates, COALESCE(RemainingAmount,0) FROM Tickets WHERE Id=${id};`), ['states', 'remaining'])[0];
  if (!row) throw new Error('Sipariş bulunamadı.');
  let states;
  try { states = JSON.parse(row.states); } catch { throw new Error('Sipariş durumu okunamadı.'); }
  if (!Array.isArray(states)) throw new Error('Sipariş durumu beklenmeyen formatta.');
  if (!states.some(item => item && item.SN === 'Paket')) throw new Error('Bu siparişte paket durumu bulunamadı.');

  const remaining = +row.remaining || 0;
  let paymentInserted = false;
  if (remaining > 0) {
    await sqlWide(`SET NOCOUNT ON; INSERT INTO Payments (TicketId, PaymentTypeId, DepartmentId, Name, Description, Date, AccountTransactionId, Amount, TenderedAmount, UserId, TerminalId, ExchangeRate, CanAdjustTip)
      VALUES (${id}, ${PAYMENT_TYPE_CASH}, ${PAYMENT_DEPARTMENT_ID}, N'Nakit', N'Kurye teslimat tahsilatı', GETDATE(), 0, ${remaining}, ${remaining}, ${PAYMENT_USER_ID}, ${PAYMENT_TERMINAL_ID}, 1, 0);`);
    paymentInserted = true;
  }
  upsertState(states, 'Paket', 'Teslim Edildi');
  upsertState(states, 'Durum', 'Ödendi');
  const json = JSON.stringify(states).replace(/'/g, "''");
  await sqlWide(`SET NOCOUNT ON; UPDATE Tickets SET TicketStates=N'${json}', IsClosed=1, RemainingAmount=0 WHERE Id=${id};`);
  return { paymentInserted, amountCollected: remaining };
}

module.exports = { couriers, activeCourierOrders, unassignedPackages, orderContent, markDelivered };
