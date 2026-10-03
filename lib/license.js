/* Musterinin erisimi gecerli mi kontrolu - abonelik durumu VE lisans bitis
   tarihi birlikte degerlendirilir. Musteri girisi, kurye girisi ve ajan
   push'u AYNI kontrolu kullanir (tek yerden yonetilsin, birbirinden sapmasin). */
function licenseActive(customer) {
  if (!customer || customer.subscription_status !== 'active') return false;
  if (customer.license_expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (customer.license_expires_at < today) return false;
  }
  return true;
}

module.exports = { licenseActive };
