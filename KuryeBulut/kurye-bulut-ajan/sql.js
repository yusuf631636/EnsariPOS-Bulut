/* C:\ensari\server.js'deki sql()/rows() deseninin uyarlanmasi.
   ONEMLI FARK: sorgu komut satiri argumani olarak degil, gecici bir dosyadan (-i) okutulur.
   Cift tirnak iceren (JSON_MODIFY, TicketStates JSON'u gibi) sorgular Windows'un execFile
   komut satiri quoting'inde bozuluyordu ("Unexpected argument" hatasi) - dosya bazli
   yaklasim bu sorunu tamamen ortadan kaldirir.

   TURKCE KARAKTER DUZELTMESI (canli, gercek bir musteride dogrulandi - "Gelismis Kurye
   Sistemi" gelistirmesi sirasinda yakalandi): winget artik SADECE modern "go-sqlcmd"
   dagitiyor (eski ODBC tabanli sqlcmd kaldirildi) ve bu yeni arac, ciktisi bir dosyaya/
   boruya YONLENDIRILDIGINDE Turkce karakterleri ("ç/ş/ğ/ı" gibi) SESSIZCE "?" ile
   degistiriyor - hangi codepage'le decode edilirse edilsin duzelmeyen, KAYNAKTA olusan
   bir kayip (QR Menü testinde "Ankara Döneri" -> "Ankara D?neri" olarak geldigi
   dogrulandi). Codepage tahmini TAMAMEN birakildi: sorgu METNI artik UTF-16LE (+BOM)
   dosyaya yaziliyor, sonuc da "-u -o <dosya>" ile GERCEK UTF-16LE dosyasina yazdirilip
   oyle okunuyor - hem eski (ODBC) hem yeni (go-sqlcmd) sqlcmd ile ayni sekilde dogru
   calisiyor, hicbir codepage varsayimi yok. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const config = fs.existsSync(path.join(__dirname, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) : {};
const SQL_SERVER = process.env.SAMBAPOS_SQL_SERVER || config.server || 'localhost';
const SQL_DATABASE = process.env.SAMBAPOS_DB || config.database || 'SAMBAPOS5';
const SQL_USER = process.env.SAMBAPOS_SQL_USER || config.user || '';
const SQL_PASSWORD = process.env.SAMBAPOS_SQL_PASSWORD || config.password || '';

/* "spawn sqlcmd ENOENT": bazi makinelerde sqlcmd PATH'te olsa da Windows SERVISLERI
   (bu ajanin da NSSM ile calistigi sekil) PATH'e sonradan eklenen bir seyi
   goremeyebilir (Servis Denetleyicisi ortam degiskenlerini kendi baslama anindan
   miras alir). Once duz "sqlcmd" (PATH) denenir, ENOENT alinirsa bilinen kurulum
   konumlari sirayla denenir - boylece reboot beklemeden calisir. */
const KNOWN_SQLCMD_PATHS = [
  'C:\\Program Files\\Sqlcmd\\sqlcmd.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\WinGet\\Links\\sqlcmd.exe'),
  'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\SQLCMD.EXE',
  'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\180\\Tools\\Binn\\SQLCMD.EXE',
  'C:\\Program Files (x86)\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\SQLCMD.EXE',
];
let resolvedSqlcmd = config.sqlcmdPath || null;

const BOM = '\ufeff';
function stripBom(text) { return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }
function runSqlcmd(exe, args, cb) {
  execFile(exe, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, cb);
}

function sql(query, { wide = false } = {}) {
  return new Promise((resolve, reject) => {
    const auth = SQL_USER && SQL_PASSWORD ? ['-U', SQL_USER, '-P', SQL_PASSWORD] : ['-E'];
    const trust = config.options && config.options.trustServerCertificate ? ['-C'] : [];
    const widthFlag = wide ? ['-y', '8000'] : ['-W'];
    const tag = crypto.randomBytes(8).toString('hex');
    const inFile = path.join(os.tmpdir(), `kurye-in-${tag}.sql`);
    const outFile = path.join(os.tmpdir(), `kurye-out-${tag}.txt`);
    fs.writeFileSync(inFile, BOM + query, 'utf16le');
    const args = ['-S', SQL_SERVER, ...auth, ...trust, '-d', SQL_DATABASE, '-h', '-1', ...widthFlag, '-s', '|', '-u', '-o', outFile, '-i', inFile];

    const cleanup = () => { fs.unlink(inFile, () => {}); fs.unlink(outFile, () => {}); };
    const finish = (e, err) => {
      const stderr = String(err || '');
      let stdout = '';
      try { stdout = stripBom(fs.readFileSync(outFile, 'utf16le')); } catch { /* olusmadiysa bos kalir */ }
      cleanup();
      if (e) { reject(new Error(stderr.trim() || stdout.trim() || e.message)); return; }
      /* sqlcmd, "not a recognized built-in function name" gibi bazi derleme
         hatalarinda cikis kodunu 0 dondurup hata metnini STDOUT'a yaziyor -
         boylece hata, gercek veri satiri sanilip courier_orders gibi
         tablolara col cop olarak islenebiliyordu (baska bir musteride tespit
         edildi). "Msg N, Level N, State N" desenini gorursek bunu artik
         basarili sonuc degil, hata olarak ele aliyoruz. */
      if (/^Msg \d+, Level \d+, State \d+/m.test(stdout)) { reject(new Error(stdout.trim())); return; }
      resolve(stdout.trim());
    };

    runSqlcmd(resolvedSqlcmd || 'sqlcmd', args, (e, out, err) => {
      if (e && e.code === 'ENOENT' && !resolvedSqlcmd) {
        const candidate = KNOWN_SQLCMD_PATHS.find(p => p && fs.existsSync(p));
        if (candidate) {
          resolvedSqlcmd = candidate;
          return runSqlcmd(candidate, args, (e2, out2, err2) => finish(e2, err2));
        }
      }
      finish(e, err);
    });
  });
}
function rows(text, keys) {
  return text ? text.split(/\r?\n/).filter(Boolean).map(line => {
    const v = line.split('|').map(x => x.trim());
    return Object.fromEntries(keys.map((k, i) => [k, v[i] || '']));
  }) : [];
}

module.exports = { sql, rows, config };
