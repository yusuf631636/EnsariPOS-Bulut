CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dealers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_salt   TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  phone           TEXT,
  sms_header      TEXT,
  commission_rate REAL NOT NULL DEFAULT 0,
  license_quota   INTEGER,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS download_counts (
  file    TEXT PRIMARY KEY,
  count   INTEGER NOT NULL DEFAULT 0,
  last_at TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id           INTEGER NOT NULL REFERENCES dealers(id),
  business_name       TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  sms_header          TEXT,
  activation_key      TEXT NOT NULL UNIQUE,
  password_salt       TEXT,
  password_hash       TEXT,
  has_kurye           INTEGER NOT NULL DEFAULT 1,
  has_patron          INTEGER NOT NULL DEFAULT 1,
  subscription_status TEXT NOT NULL DEFAULT 'active',
  license_expires_at  TEXT,
  last_login_at       TEXT,
  deleted_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_dealer ON customers(dealer_id);

CREATE TABLE IF NOT EXISTS agent_status (
  customer_id  INTEGER PRIMARY KEY REFERENCES customers(id),
  connected    INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS customer_snapshots (
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id),
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

/* Asagidaki 4 tablo "Kurye Bulut" (coklu kiracili kurye takip) icin -
   C:\kurye takip'in yerel SQLite semasinin musteri bazinda merkezilesmis
   hali. Ajan (C:\kurye-bulut-ajan) WebSocket uzerinden bunlari besler. */
CREATE TABLE IF NOT EXISTS courier_pins (
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  courier_name TEXT NOT NULL,
  pin          TEXT NOT NULL,
  phone        TEXT,
  PRIMARY KEY (customer_id, courier_name)
);

CREATE TABLE IF NOT EXISTS courier_orders (
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  ticket_id      TEXT NOT NULL,
  courier_name   TEXT NOT NULL,
  number         TEXT,
  total          REAL,
  package_status TEXT,
  customer_name  TEXT,
  address        TEXT,
  phone          TEXT,
  content_json   TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (customer_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_courier_orders_courier ON courier_orders(customer_id, courier_name);

/* Acik ama HENUZ hicbir kuryeye atanmamis paket siparisleri - courier_orders'a
   BENZER ama BAGIMSIZ tablo (courier_orders'in davranisi/semasi degismedi). */
CREATE TABLE IF NOT EXISTS unassigned_orders (
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  ticket_id     TEXT NOT NULL,
  number        TEXT,
  total         REAL,
  customer_name TEXT,
  address       TEXT,
  phone         TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (customer_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS courier_locations (
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  courier_name TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  accuracy     REAL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (customer_id, courier_name)
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  action      TEXT NOT NULL,
  ticket_id   TEXT,
  created_at  INTEGER NOT NULL,
  done_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_actions_open ON pending_actions(customer_id, done_at);

CREATE TABLE IF NOT EXISTS delivery_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  ticket_id    TEXT,
  courier_name TEXT,
  event        TEXT NOT NULL,
  detail       TEXT,
  amount       REAL,
  at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_events_customer ON delivery_events(customer_id, at);

/* Patron Raporu'nun (C:\ensari, PatronRaporuSetup.exe olarak dagitilir) her
   push'unda SADECE "bugun"un ozetini gonderdigi icin (customer_snapshots
   ustune yazilir, gecmis TUTULMAZ) - burada gun bazinda arsivlenir. Ajanin
   KENDISINE hic dokunulmadi, tamamen bulut tarafinda, geriye donuk uyumlu
   bir ekleme: eski kurulumlar aynen calismaya devam eder, sadece bugunden
   itibaren gun gun birikmeye baslar (gecmise donuk veri YOKTUR). */
/* Patron Raporu'nun CANLI/etkilesimli kismi (fiyat guncelleme) - Kurye Bulut'taki
   agent-ws.js + pending_actions deseninin aynisi, sadece genel amacli: courier'daki
   gibi sabit action+ticket_id yerine serbest payload_json (fiyat komutunun alanlari
   farkli: priceId, price). Bkz. C:\toplu\patron-ws.js, C:\ensari\patron-cloud.js. */
CREATE TABLE IF NOT EXISTS patron_pending_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  action      TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER,
  done_at     INTEGER,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_patron_pending_open ON patron_pending_actions(customer_id, done_at);

/* Restoranin guncel menu/fiyat listesinin bulut aynasi - SADECE arama ve
   "hangi fiyati guncelleyecegim" icin, courier_orders'daki gibi her push'ta
   o musterinin satirlari silinip yeniden yazilir (saklanacak QR-menu tarzi
   ek alan yok, salt-mirror). */
CREATE TABLE IF NOT EXISTS patron_menu_items (
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  price_id     INTEGER NOT NULL,
  item_id      INTEGER NOT NULL,
  portion_id   INTEGER NOT NULL,
  item_name    TEXT NOT NULL,
  portion_name TEXT,
  tag_label    TEXT,
  price        REAL NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (customer_id, price_id)
);
CREATE INDEX IF NOT EXISTS idx_patron_menu_items_name ON patron_menu_items(customer_id, item_name);

CREATE TABLE IF NOT EXISTS patron_daily_reports (
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  report_date TEXT NOT NULL,
  sales       REAL NOT NULL DEFAULT 0,
  tickets     INTEGER NOT NULL DEFAULT 0,
  average     REAL NOT NULL DEFAULT 0,
  remaining   REAL NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (customer_id, report_date)
);
