/* QR Menü icin SambaPOS menu/fiyat okuma-yazma islemleri.

   ONEMLI: sambapos.js'e DOKUNULMAZ - kurye akisi bu dosyadan tamamen
   bagimsizdir. Ayni sql.js (temp dosya + win1254/cp857 + "Msg N, Level N"
   hata tespiti) yeniden kullanilir.

   Sema (C:\ensari\server.js'te dogrulandi):
     MenuItems -1:N- MenuItemPortions -1:N- MenuItemPrices
     PriceTag bos = standart fiyat; diger etiketler MenuItemPriceDefinitions'da
     adlandirilir (orn. PAKET = paket/uzak musteri fiyati).

   KURALLAR:
   1) JSON_VALUE / OPENJSON / ISJSON ASLA KULLANILMAZ. Bu fonksiyonlar
      veritabani uyumluluk duzeyi (compatibility level) 130'un altindaysa
      "not a recognized built-in function name" hatasi verir ve tum sorguyu
      patlatir (gercek bir musteride yasandi). Burada zaten gerekli degiller.
   2) Donen HER metin sutunu SQL tarafinda temizlenir: '|' -> '/', CR/LF -> bosluk.
      sql.js satirlari konuma gore '|' ile ayirdigi icin, icinde '|' veya satir
      sonu gecen tek bir urun adi TUM menuyu kaydirip bozabilirdi (ayni hata
      sinifi daha once bir kurye adinda yasandi). */
const { sql, rows } = require('./sql');

/* sqlcmd'nin varsayilan sutun genisligi kisitini asmak icin (-y 8000). */
function sqlWide(query) { return sql(query, { wide: true }); }

/* Bir metin sutununu pozisyonel satir ayristiriciyi bozamayacak hale getirir. */
function clean(expression) {
  return `REPLACE(REPLACE(REPLACE(${expression},'|','/'),CHAR(13),' '),CHAR(10),' ')`;
}

/* MenuItems'ta kategori benzeri bir sutun var mi? SambaPOS surumune gore
   degisebilir, bu yuzden VARSAYMIYORUZ. Kontrol icin sys.columns katalog
   gorunumu kullanilir - JSON fonksiyonlarinin aksine HER SQL Server
   surumunde ve HER uyumluluk duzeyinde calisir. Sonuc modul degiskeninde
   onbelleklenir (surec boyunca bir kez sorulur). */
const CATEGORY_CANDIDATES = ['GroupCode', 'GroupName', 'Category'];
let categoryColumn;         // undefined = henuz bakilmadi, '' = yok, aksi = sutun adi

async function detectCategoryColumn() {
  if (categoryColumn !== undefined) return categoryColumn;
  categoryColumn = '';
  for (const name of CATEGORY_CANDIDATES) {
    try {
      const text = await sql(`SET NOCOUNT ON; SELECT COUNT(*) FROM sys.columns WHERE object_id=OBJECT_ID('MenuItems') AND name='${name}';`);
      if (Number(String(text).trim()) > 0) { categoryColumn = name; break; }
    } catch { /* probe basarisizsa kategori yok kabul edilir - menu yine gelir */ }
  }
  return categoryColumn;
}

/* Fiyat etiketi adlari (PAKET -> "Paket Fiyati" gibi). Bu tablo bazi
   kurulumlarda olmayabilir - hata menuyu DUSURMEZ, etiket ham haliyle kalir. */
async function priceTagNames() {
  try {
    const text = await sql(`SET NOCOUNT ON; SELECT ${clean('PriceTag')},${clean("COALESCE(NULLIF(Name,''),PriceTag)")} FROM MenuItemPriceDefinitions;`);
    return Object.fromEntries(rows(text, ['tag', 'name']).filter(row => row.tag).map(row => [row.tag, row.name]));
  } catch { return {}; }
}

/* Bazi musteriler SambaPOS'ta ekstra bir Ekran Menu (Screen Menu) olusturup
   QR'da GORUNMESINI istedikleri urunleri SADECE oraya ekliyor - boylece ana
   adisyon ekranindaki eski/kullanilmayan urunler QR'a hic cikmiyor (13.09.2026,
   ÖZ URFA talebi: "adisyon ekranindaki/Qrmenu adindaki menuyu ceksin"). Byle
   bir ekran VARSA (asagidaki adaylardan biriyle eslesirse) SADECE icindeki
   urunler dondurulur; YOKSA (cogu musteri, ya da tablo/sutun adi musterinin
   SambaPOS surumunde farkliysa) davranis HIC degismez - TUM MenuItems
   kullanilir. Her adim ayri try/catch icinde: biri patlarsa ozellik sessizce
   devre disi kalir, menu ASLA dusmez.

   "overrideName" panelden musterinin SECTIGI ekran menu adi (bkz. QR Menü
   panelindeki "Kaynak ekran menü" - bulut buna gore menu-push/menu-poll
   yanitinda screenMenuFilter dondurur, menu-agent.js bunu burada gecirir):
     undefined -> henuz bir secim yok, asagidaki ADAY isimler denenir (otomatik)
     ''        -> musteri ACIKCA "tum urunler" secti, hic filtre uygulanmaz
     "Ad"      -> musteri ACIKCA bu ismi secti, SADECE bu isim denenir */
const QR_SCREEN_MENU_NAMES = ['Qrmenu', 'QR Menü', 'QR Menu', 'QRMenu', 'Qr Menu', 'Qr Menü'];

/* Panelde "Kaynak ekran menü" secim kutusunu doldurmak icin - musterinin
   SambaPOS'ta tanimli TUM ekran menulerinin adlari (filtre uygulanmadan). */
async function availableScreenMenus() {
  try {
    const text = await sql(`SET NOCOUNT ON; SELECT Id,${clean('Name')} FROM ScreenMenus ORDER BY Name;`);
    return rows(text, ['id', 'name']).filter(r => /^\d+$/.test(r.id) && r.name).map(r => ({ id: Number(r.id), name: r.name }));
  } catch { return []; }
}

async function qrScreenMenuItemIds(overrideName) {
  if (overrideName === '') return { ids: null, matched: null };
  const names = overrideName ? [overrideName] : QR_SCREEN_MENU_NAMES;
  for (const name of names) {
    try {
      const idText = await sql(`SET NOCOUNT ON; SELECT TOP 1 Id FROM ScreenMenus WHERE Name=N'${name.replace(/'/g, "''")}';`);
      const id = String(idText).trim();
      if (!/^\d+$/.test(id)) continue;
      const text = await sqlWide(`SET NOCOUNT ON; SELECT DISTINCT smi.MenuItemId FROM ScreenMenuItems smi
        INNER JOIN ScreenMenuCategories smc ON smc.Id=smi.ScreenMenuCategoryId
        WHERE smc.ScreenMenuId=${Number(id)} AND smi.MenuItemId IS NOT NULL;`);
      const ids = rows(text, ['itemId']).map(r => Number(r.itemId)).filter(Number.isInteger);
      if (ids.length) return { ids: new Set(ids), matched: name };
    } catch { /* bu aday isim/tablo yoksa siradakine gec */ }
  }
  return { ids: null, matched: null };
}

async function menuItems(overrideName) {
  const column = await detectCategoryColumn();
  const groupExpression = column ? clean(`COALESCE(mi.${column},'')`) : `''`;
  const itemsQuery = `SET NOCOUNT ON; SELECT mi.Id,${clean("COALESCE(NULLIF(mi.Name,''),'Bilinmeyen')")},mp.Id,${clean("COALESCE(NULLIF(mp.Name,''),'Normal')")},pr.Id,${clean("COALESCE(pr.PriceTag,'')")},COALESCE(pr.Price,0),${groupExpression}
    FROM MenuItems mi
    INNER JOIN MenuItemPortions mp ON mp.MenuItemId=mi.Id
    INNER JOIN MenuItemPrices pr ON pr.MenuItemPortionId=mp.Id
    ORDER BY mi.Name,mp.Name,pr.PriceTag;`;
  const [itemsText, tagNames, screenFilter, screenMenus] = await Promise.all([
    sqlWide(itemsQuery), priceTagNames(), qrScreenMenuItemIds(overrideName), availableScreenMenus()
  ]);
  const allowedIds = screenFilter.ids;
  const filteredItems = rows(itemsText, ['itemId', 'itemName', 'portionId', 'portionName', 'priceId', 'priceTag', 'price', 'groupCode'])
    .filter(row => /^\d+$/.test(row.priceId) && /^\d+$/.test(row.itemId))
    .filter(row => !allowedIds || allowedIds.has(Number(row.itemId)))
    .map(row => ({
      priceId: Number(row.priceId),
      itemId: Number(row.itemId),
      portionId: Number(row.portionId) || 0,
      itemName: row.itemName,
      portionName: row.portionName,
      groupCode: row.groupCode || '',
      priceTag: row.priceTag,
      tagLabel: row.priceTag ? (tagNames[row.priceTag] || row.priceTag) : 'Standart',
      price: Number(row.price) || 0
    }))
    /* Bir urunun (item+porsiyon) BIRDEN FAZLA fiyat etiketi (Paket/Salon vb.)
       olabilir - ONCEDEN hepsi ayri ayri QR Menu'ye satir olarak gidiyordu,
       ayni urun birden fazla kez gorunuyordu. Simdilik SADECE ILK fiyat
       alinir (13.09.2026, ÖZ URFA talebiyle - "ikinci fiyati cekmesin ilk
       fiyat olsun simdilik"), digerleri yoksayilir. Siralamadaki (ORDER BY
       ...,pr.PriceTag) ILK satir "ilk fiyat" kabul edilir. */
    .reduce((acc, item) => {
      const key = `${item.itemId}:${item.portionId}`;
      if (!acc.seen.has(key)) { acc.seen.add(key); acc.list.push(item); }
      return acc;
    }, { seen: new Set(), list: [] }).list
    /* Fiyati 0 veya 1 olan kayitlar (SambaPOS'ta genelde kullanilmayan/yer tutucu
       fiyat etiketleri, "modifier" satirlari vb.) QR Menu'ye musteri onune
       gercek bir urunmus gibi cikmasin diye elenir (13.09.2026, ÖZ URFA'da
       708 urunun icinde bu turden cok sayida kayit oldugu fark edildi). */
    .filter(item => item.price > 1);
  return { items: filteredItems, screenMenus, screenMenuMatched: screenFilter.matched };
}

/* C:\ensari\server.js'teki updateMenuPrice ile AYNI dogrulama titizligi:
   her iki deger de SQL metnine girmeden ONCE regex'ten gecer (sambapos.js'teki
   markDelivered'in Number(ticketId) disiplininin ayni uygulamasi). */
async function updateMenuPrice(priceId, price) {
  if (!/^\d+$/.test(String(priceId))) throw new Error('Geçersiz fiyat kaydı.');
  if (!/^\d+(\.\d{1,2})?$/.test(String(price).trim())) throw new Error('Geçersiz fiyat formatı.');
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0 || value > 999999) throw new Error('Fiyat 0 ile 999999 arasında olmalı.');
  const query = `SET NOCOUNT ON; UPDATE MenuItemPrices SET Price=${value} OUTPUT deleted.Price,inserted.Price WHERE Id=${Number(priceId)};`;
  const result = rows(await sql(query), ['oldPrice', 'newPrice']);
  if (!result.length) throw new Error('Fiyat kaydı bulunamadı (silinmiş olabilir).');
  return { oldPrice: +result[0].oldPrice, newPrice: +result[0].newPrice };
}

module.exports = { menuItems, updateMenuPrice, detectCategoryColumn };
