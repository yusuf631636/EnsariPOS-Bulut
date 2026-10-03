/* Ilk kurulumda tek seferlik calistirilir: node bootstrap-admin.js <email> <sifre>
   Ayni e-posta zaten varsa sifresini gunceller (yeniden calistirmak guvenlidir). */
const { db } = require('./db');
const auth = require('./auth');

const email = String(process.argv[2] || '').trim().toLowerCase();
const password = String(process.argv[3] || '');

if (!email || !email.includes('@') || password.length < 4) {
  console.error('Kullanım: node bootstrap-admin.js <email> <şifre (en az 4 karakter)>');
  process.exit(1);
}

const cred = auth.makeCredential(password);
const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE admins SET password_salt = ?, password_hash = ? WHERE id = ?').run(cred.salt, cred.hash, existing.id);
  console.log(`Admin güncellendi: ${email}`);
} else {
  db.prepare('INSERT INTO admins (email, password_salt, password_hash) VALUES (?, ?, ?)').run(email, cred.salt, cred.hash);
  console.log(`Admin oluşturuldu: ${email}`);
}
