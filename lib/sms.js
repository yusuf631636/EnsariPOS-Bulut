/* Mas GSM (senagsm altyapili) SMS API entegrasyonu.
   ONEMLI: ayarlar C:\toplu\sms-config.json dosyasindan HER cagrida yeniden
   okunur (basta bir kere okuyup bellekte tutmuyoruz) - boylece saglayici
   API bilgileri (kullanici adi/sifre/hostname) degisirse veya farkli bir
   SMS firmasina gecilirse, sadece o dosyayi duzenlemek yeterli olur, kod
   degisikligi veya servis yeniden baslatma gerekmez. */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'sms-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/* Numarayi API'nin bekledigi 90XXXXXXXXXX (12 haneli) formatina getirir. */
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
  else if (digits.length === 11 && digits.startsWith('0')) digits = '90' + digits.slice(1);
  return digits;
}

const ERROR_MESSAGES = {
  97: 'SMS servisi POST beklerken GET geldi (sistem hatasi).',
  91: 'SMS servisine gonderilen veri okunamadi.',
  89: 'SMS istegi hatali formatlandi.',
  87: 'SMS servisi kullanici adi/sifresi hatali - sms-config.json dosyasini kontrol edin.',
  85: 'Belirtilen SMS başlığı bulunamadı veya onaylanmamış.',
  83: 'Gönderilecek numara veya mesaj metni boş.',
  81: 'SMS kredisi yetersiz.',
  77: 'Aynı SMS son 2 dakika içinde zaten gönderilmiş.',
  99: 'SMS servisinde bilinmeyen bir hata oluştu.'
};

function escapeXml(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

/* Tek numaraya tek metin gonderir. header: onaylanmis basliklardan biri
   (max 11 karakter). Basarili olursa {ok:true, dlrId}, olmazsa
   {ok:false, code, error} doner - hicbir zaman exception firlatmaz,
   cagiran taraf her zaman bu sekli kontrol eder. */
async function sendSms(phone, message, header) {
  const config = loadConfig();
  if (!config || !config.hostname || !config.username || !config.password) {
    return { ok: false, error: 'sms-config.json eksik veya hatalı.' };
  }
  const gsm = normalizePhone(phone);
  if (gsm.length !== 12) return { ok: false, error: 'Geçersiz telefon numarası.' };
  if (!header) return { ok: false, error: 'SMS başlığı (gönderici adı) belirtilmedi.' };
  if (!message) return { ok: false, error: 'Mesaj metni boş olamaz.' };

  const xml = `<sms>` +
    `<username>${escapeXml(config.username)}</username>` +
    `<password>${escapeXml(config.password)}</password>` +
    `<header>${escapeXml(header)}</header>` +
    `<validity>2880</validity>` +
    `<message><gsm><no>${gsm}</no></gsm><msg><![CDATA[${message}]]></msg></message>` +
    `</sms>`;

  let text;
  try {
    const res = await fetch(`${config.hostname}/api/smspost/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body: xml,
      signal: AbortSignal.timeout(15000)
    });
    text = (await res.text()).trim();
  } catch (error) {
    return { ok: false, error: `SMS servisine ulaşılamadı: ${error.message}` };
  }

  if (text.startsWith('00')) return { ok: true, dlrId: text.slice(3).trim() };
  const code = text.trim();
  return { ok: false, code, error: ERROR_MESSAGES[code] || `SMS gönderilemedi (kod ${code}).` };
}

/* Hesaptaki onaylanmis SMS basliklarini listeler - admin panelinde secim
   listesi doldurmak icin kullanilir. */
async function listHeaders() {
  const config = loadConfig();
  if (!config) return [];
  try {
    const res = await fetch(`${config.hostname}/api/originator/v1?username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    if (!text.startsWith('00')) return [];
    return text.slice(3).trim().split('|').filter(Boolean);
  } catch { return []; }
}

module.exports = { sendSms, listHeaders, normalizePhone };
