/* Zamanlanmis gorev (Windows Task Scheduler) tarafindan gunde bir kez
   calistirilan, TEK SEFERLIK yedekleme betigi. Ana sunucu surecine (server.js)
   hicbir sekilde dokunmaz/onu yeniden baslatmaz - tamamen bagimsiz calisir. */
const { runBackup } = require('./lib/backup');
try {
  const file = runBackup();
  console.log(new Date().toISOString(), 'Yedek alindi:', file);
  process.exit(0);
} catch (error) {
  console.error(new Date().toISOString(), 'Yedekleme basarisiz:', error.message);
  process.exit(1);
}
