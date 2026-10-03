/* Veritabaninin (cloud.db) gunluk yedegini alir. Restart'lardan/olasi
   bozulmalardan bagimsiz, ayri bir dosyaya "SQLite VACUUM INTO" ile ATOMIK
   sekilde alinir (canli veritabani acikken bile tutarli, yari-yazilmis
   olmayan bir kopya garanti eder - ham dosya kopyalamaktan daha guvenli). */
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const KEEP_DAYS = 14;

function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `cloud-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);

  // Eski yedekleri temizle - sadece son KEEP_DAYS gunu tut.
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.startsWith('cloud-') || !name.endsWith('.db')) continue;
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }
  return file;
}

module.exports = { runBackup, BACKUP_DIR };
