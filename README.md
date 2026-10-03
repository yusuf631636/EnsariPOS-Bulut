# EnsariPOS Bulut — Lisans ve Bulut Sunucusu

EnsariPOS bulut sunucusu (SambaPOS / AlfaPOS ürünleri için): lisans ve aktivasyon, yönetici/bayi panelleri, restoran bilgisayarlarına tünel, otomatik güncelleme, SMS. Node.js.

> 🇬🇧 Cloud server for EnsariPOS products: licensing, admin/dealer panels, tunnels to restaurant PCs, auto-updates, SMS (Node.js).

> EnsariPOS ürünlerinden biridir · Tüm ürünler: https://github.com/yusuf631636/EnsariPOS

## Özellikler

- Ürün lisansları ve aktivasyon anahtarları (ürün başına ayrı)
- Yönetici ve bayi panelleri
- Restoran bilgisayarlarına WebSocket tünel (QR menü, kurye, garson, patron)
- Otomatik güncelleme kanalları
- SMS bildirimleri, günlük yedek

## Gereksinimler

- Linux (Ubuntu) veya Windows sunucu, Node.js 18+
- Alan adı ve TLS için önde bir ters vekil (Caddy / nginx) — örnek: `deploy/Caddyfile`
- Kurulum notları: `1-ONCE-BUNU-OKU.txt`, `deploy/NASIL-YAPILACAK.txt`
- **Node.js sürümü** için: Node.js 18 LTS veya üstü. Node.js sürümleri SambaPOS'un SQL Server veritabanına da doğrudan bağlanır; SQL Server adresi/kullanıcısı `config.json`'a yazılır.
- **Kurulum paketi (setup.exe)** üretmek için: Inno Setup 6.

## Kaynak koddan çalıştırma

```
git clone https://github.com/yusuf631636/EnsariPOS-Bulut.git
cd EnsariPOS-Bulut
```

**Node.js** (`.`):

```
cd .
npm install
copy config.example.json config.json     # kendi bilgilerinizi girin; bu dosya depoya EKLENMEZ
node server.js
```

Ayrıntılı kurulum: `1-ONCE-BUNU-OKU.txt`. SMS için `sms-config.example.json` → `sms-config.json`.

**Kurulum paketi**: `*.iss` dosyaları Inno Setup betikleridir.

## Klasörler
| Klasör | İçerik |
|---|---|
| `lib, routes` | Sunucu çekirdeği ve API uçları |
| `public` | Yönetici, bayi ve müşteri panelleri |
| `QRMenu, KuryeBulut, KuryeSistemi, UltraPaketci, GarsonSistemi, Patron` | Ürünlere özel bulut modülleri ve tüneller |
| `deploy` | Sunucuya kurulum notları |

## Güvenlik

`config.json`, veritabanları, loglar, imza anahtarları ve müşteri verileri depoya eklenmez (`.gitignore`); örnek ayarlar `config.example.json` dosyalarındadır. Güvenlik açığı bildirimi: [SECURITY.md](SECURITY.md).

## Katkı

Katkılar Pull Request ile gelir ve proje sahibi onaylayınca birleştirilir — bkz. [CONTRIBUTING.md](CONTRIBUTING.md).

## Lisans

MIT — bkz. [LICENSE](LICENSE).
