const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karisabilecek 0/O, 1/I harfleri cikarildi
function randomGroup(len) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
/* XXXX-XXXX-XXXX-XXXX formatinda, elle yazilirken hata riskini azaltan bir aktivasyon anahtari. */
function generateActivationKey() {
  return [randomGroup(4), randomGroup(4), randomGroup(4), randomGroup(4)].join('-');
}
/* db: customers tablosunda "column" sutununda benzersiz oldugunu garanti eder.
   column parametresi disaridan gelmez (sabit iki deger), SQL injection riski yok. */
const ALLOWED_COLUMNS = new Set(['activation_key', 'gk_activation_key', 'gs_activation_key', 'ultra_activation_key', 'kiosk_activation_key']);
function generateUniqueActivationKey(db, column = 'activation_key') {
  const safeColumn = ALLOWED_COLUMNS.has(column) ? column : 'activation_key';
  const check = db.prepare(`SELECT 1 FROM customers WHERE ${safeColumn} = ?`);
  for (let attempt = 0; attempt < 10; attempt++) {
    const key = generateActivationKey();
    if (!check.get(key)) return key;
  }
  throw new Error('Benzersiz aktivasyon anahtari uretilemedi.');
}

module.exports = { generateActivationKey, generateUniqueActivationKey };
