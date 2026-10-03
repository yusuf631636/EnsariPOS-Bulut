const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'cloud.db'));
/* "database is locked" hatasi - canli sunucu loglarinda gercek musterilerde
   (agent-ws.js'nin her 6 saniyede bir gelen kurye senkron yazmasi) SUREKLI
   tekrarlandigi tespit edildi. Kok neden: varsayilan SQLite "DELETE" journal
   modu yazma sirasinda tum veritabanini kilitler VE busy_timeout varsayilan
   olarak 0'dir (kilitle karsilasinca ANINDA hata verir, hic beklemez) - onlarca
   musterinin ajani ayni anda yazmaya calisinca kacinilmaz sekilde carpisiyordu.
   WAL modu okuma/yazmayi birbirinden ayirip cok daha iyi eszamanlilik saglar,
   busy_timeout ise kisa bir carpismada hemen hata vermek yerine bir sure
   bekleyip tekrar dener - ikisi birlikte bu hata sinifini ortadan kaldirir. */
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/* schema.sql'deki CREATE TABLE IF NOT EXISTS, tablo zaten varsa yeni eklenen
   sutunlari eklemez - bu yuzden var olan kurulumlar icin kucuk, tekrar
   calistirilmasi guvenli bir migrasyon burada yapilir. */
try { db.exec('ALTER TABLE customers ADD COLUMN license_expires_at TEXT'); } catch { /* sutun zaten var */ }
// 30.09.2026: Patron toplu zam - urun kategorisi (SambaPOS MenuItems.GroupCode). Eski (Node) ajanlar gondermez -> bos kalir.
try { db.exec("ALTER TABLE patron_menu_items ADD COLUMN group_name TEXT NOT NULL DEFAULT ''"); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN email TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN phone TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN sms_header TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE dealers ADD COLUMN phone TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE dealers ADD COLUMN website TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE dealers ADD COLUMN license_quota INTEGER'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE dealers ADD COLUMN sms_header TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN has_kurye INTEGER NOT NULL DEFAULT 1'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN has_patron INTEGER NOT NULL DEFAULT 1'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN has_qrmenu INTEGER NOT NULL DEFAULT 0'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN has_gelismis_kurye INTEGER NOT NULL DEFAULT 0'); } catch { /* sutun zaten var */ }
/* Gelismis Kurye Sistemi, diger 3 urunden (Kurye/Patron/QR Menu) AYRI bir aktivasyon
   anahtariyla calisir - musteri karisikligini onlemek icin (13.09.2026, canli bir
   karisiklik sonrasi eklendi). Nullable: admin "Gelismis Kurye" acana kadar bos kalir,
   ilk acilista otomatik uretilir (bkz. routes/admin.js updateCustomer). */
try { db.exec('ALTER TABLE customers ADD COLUMN gk_activation_key TEXT'); } catch { /* sutun zaten var */ }
try { db.exec(`CREATE TABLE IF NOT EXISTS gelismis_kurye_status (
  customer_id  INTEGER PRIMARY KEY REFERENCES customers(id),
  last_seen_at TEXT
)`); } catch { /* tablo zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN last_login_at TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN deleted_at TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE dealers ADD COLUMN last_login_at TEXT'); } catch { /* sutun zaten var */ }
/* Admin panelinde sifre unutuldugunda SMS ile sifirlama icin - dealers/customers'taki
   AYNI desen (phone + onaylanmis sms_header). Nullable: doldurulana kadar "Sifremi
   unuttum" sessizce hicbir sey yapmaz (13.09.2026, canli bir istek sonrasi eklendi). */
try { db.exec('ALTER TABLE admins ADD COLUMN phone TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE admins ADD COLUMN sms_header TEXT'); } catch { /* sutun zaten var */ }
try { db.exec(`CREATE TABLE IF NOT EXISTS download_counts (
  file TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  last_at TEXT
)`); } catch { /* tablo zaten var */ }

/* Garson Sistemi - Gelismis Kurye Sistemi ile AYNI desen (kendi ayri aktivasyon
   anahtari, nullable, admin "Garson Sistemi" acana kadar bos kalir, ilk acilista
   otomatik uretilir - bkz. routes/admin.js updateCustomer). Tamamen bagimsiz bir
   urun/klasor (C:\garson-sistemi) - kod duzeyinde hicbir urune bagli degil. */
try { db.exec('ALTER TABLE customers ADD COLUMN has_garson INTEGER NOT NULL DEFAULT 0'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN gs_activation_key TEXT'); } catch { /* sutun zaten var */ }

/* Admin panelindeki "Restoranlar" listesini Aktif/Pasif/Test olarak gruplamak
   icin - isme gore tahmin etmek yerine acik bir bayrak (bkz. routes/admin.js
   updateCustomer, public/admin/app.js). Gercek musteriler etkilenmez,
   varsayilan 0. */
try { db.exec('ALTER TABLE customers ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0'); } catch { /* sutun zaten var */ }
try { db.exec(`CREATE TABLE IF NOT EXISTS garson_status (
  customer_id  INTEGER PRIMARY KEY REFERENCES customers(id),
  last_seen_at TEXT
)`); } catch { /* tablo zaten var */ }

/* Ultra Paketçi - Gelismis Kurye Sistemi'nin genisletilmis surumu. Kullanici istegi
   (15.09.2026): ayni gk_activation_key'i paylasmasin - AYNI restoranda ikisi yan yana
   kurulup AYNI anahtarla buluta baglanmaya calisirsa, tunel kayit defteri musteri
   basina TEK baglanti tuttugundan (bkz. gk-tunnel.js connections Map) ikisi birbirinin
   yerini ALIYORDU (son baglanan kazaniyor) - "ultra.ornek-alanadi.com'a girince Gelismis
   Kurye Sistemi'nin verisi geliyor" seklinde canli tespit edildi. Kendi AYRI anahtari +
   AYRI tunel (ultra-tunnel.js, /ultra-tunnel) + AYRI durum tablosu ile bu artik
   yapisal olarak imkansiz - Gelismis Kurye Sistemi'nin gk-tunnel.js/gk-web.js/
   gelismis_kurye_status'una HICBIR SEKILDE dokunulmadi. */
try { db.exec('ALTER TABLE customers ADD COLUMN has_ultra_paketci INTEGER NOT NULL DEFAULT 0'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN ultra_activation_key TEXT'); } catch { /* sutun zaten var */ }
/* Kiosk (03.10.2026): AYRI urun, AYRI aktivasyon anahtari (gk/gs/ultra ile ayni desen, opt-in). */
try { db.exec('ALTER TABLE customers ADD COLUMN has_kiosk INTEGER NOT NULL DEFAULT 0'); } catch { /* sutun zaten var */ }
try { db.exec('ALTER TABLE customers ADD COLUMN kiosk_activation_key TEXT'); } catch { /* sutun zaten var */ }
try { db.exec(`CREATE TABLE IF NOT EXISTS ultra_paketci_status (
  customer_id  INTEGER PRIMARY KEY REFERENCES customers(id),
  last_seen_at TEXT
)`); } catch { /* tablo zaten var */ }

/* "QR Menü" urun kimligi artik C:\alfapos-qrmenu-yerel'e (musterinin kendi
   bilgisayarinda calisan, SambaPOS Menu referans uygulamasindan uretilmis
   bagimsiz urun) ait - eski bulut tabanli QR Menü servisi (C:\qrmenu)
   18.09.2026'da kaldirildi. Mevcut has_qrmenu/activation_key (PAYLASILAN
   anahtar) AYNEN kullanilmaya devam eder - ayri bir urun/anahtar ACILMADI.
   Sadece "bagli mi" gostergesi icin diger urunlerle (ultra_paketci vb.)
   AYNI desende kendi durum tablosu eklendi. */
try { db.exec(`CREATE TABLE IF NOT EXISTS qrmenu_status (
  customer_id  INTEGER PRIMARY KEY REFERENCES customers(id),
  last_seen_at TEXT
)`); } catch { /* tablo zaten var */ }

/* QR Menü artik tunel uzerinden calisiyor (19.09.2026) - musterinin herkese
   acik menu adresi (menu.ornek-alanadi.com/<slug>) icin kalici slug. Ilk tunel
   baglantisinda otomatik uretilir (bkz. qrmenu-tunnel.js:ensureSlug). */
try { db.exec('ALTER TABLE customers ADD COLUMN qrmenu_slug TEXT'); } catch { /* sutun zaten var */ }
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_qrmenu_slug ON customers(qrmenu_slug) WHERE qrmenu_slug IS NOT NULL'); } catch { /* index zaten var */ }

/* Gelismis Kurye/Ultra Paketci "Musteri Takip Linki" (28.09.2026, kullanici karari:
   "benim müşteriye manuel link gondericem"). kuryeler.ornek-alanadi.com/ultra.ornek-alanadi.com
   ("SECIM MODU") HER path icin restoran-secim cerezi ister (bkz. gk-web.js) - musteriye
   giden bir sipariş takip linki bu cerezi hic atlayamaz. Restoran bilgisayarindaki
   uygulama bir token URETINCE (kendi yerel SQLite'inda ticket_id'ye baglar) burayi da
   ayni token->customer_id eslesmesiyle haberdar eder (bkz. routes/agent.js
   registerTrackingToken) - boylece gk-web.js/ultra-web.js /takip/:token icin secim
   cerezini ATLAYIP dogrudan doGru tunele yonlendirebilir. Token'in kendisi zaten
   tahmin edilemez (crypto.randomBytes) - bu tablo sadece "hangi tunele git" bilgisi
   tasir, SambaPOS sifresi/PIN gibi hicbir hassas veri icermez. */
try { db.exec(`CREATE TABLE IF NOT EXISTS courier_order_tracking (
  token       TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product     TEXT NOT NULL DEFAULT 'gelismis_kurye',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`); } catch { /* tablo zaten var */ }

module.exports = { db };
