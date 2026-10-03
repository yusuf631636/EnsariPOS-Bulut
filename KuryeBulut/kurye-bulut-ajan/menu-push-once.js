/* Menüyü ELLE bir kez gonderir (Menu-Gonder.bat bunu calistirir).
   Servisin kendi 30 dakikalik dongusunu beklemek istemeyen restoranlar icin. */
require('./menu-agent').pushMenu({ source: 'manual' })
  .then(result => { console.log(`Menü gönderildi: ${result.sent} fiyat kaydı (bulutta ${result.saved} kayıt).`); process.exit(0); })
  .catch(error => { console.error('Menü gönderilemedi:', error.message); process.exit(1); });
