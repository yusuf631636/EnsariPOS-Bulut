async function api(path, options) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu.');
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const loginView = document.getElementById('login');
const appView = document.getElementById('app');

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('loginErr');
  errBox.hidden = true;
  try {
    await api('/api/dealer/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
    loginView.hidden = true;
    appView.hidden = false;
    loadCustomers();
    loadPrices();
    loadProfile();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/dealer/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('forgotBtn').addEventListener('click', () => {
  document.getElementById('loginForm').hidden = true;
  document.getElementById('forgotBtn').hidden = true;
  document.getElementById('forgotForm').hidden = false;
});
document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const result = await api('/api/dealer/forgot-password', { method: 'POST', body: JSON.stringify({ email: forgotEmail.value }) });
    alert(result.message);
    document.getElementById('forgotForm').hidden = true;
    document.getElementById('loginForm').hidden = false;
    document.getElementById('forgotBtn').hidden = false;
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; }
});

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/dealer/change-password', { method: 'POST', body: JSON.stringify({
      currentPassword: currentPassword.value, newPassword: newPassword.value
    }) });
    e.target.reset();
    alert('Şifreniz değiştirildi.');
  } catch (err) { alert(err.message); }
});

let pricesCache = { kurye: 50, patron: 50 };

function updatePriceTotal() {
  const k = document.getElementById('prodKurye').checked;
  const p = document.getElementById('prodPatron').checked;
  const total = (k ? pricesCache.kurye : 0) + (p ? pricesCache.patron : 0);
  document.getElementById('priceTotal').textContent = `$${total}`;
}
document.getElementById('prodKurye').addEventListener('change', updatePriceTotal);
document.getElementById('prodPatron').addEventListener('change', updatePriceTotal);

async function loadPrices() {
  try {
    const { prices } = await api('/api/dealer/prices');
    pricesCache = prices;
    document.getElementById('priceKurye').textContent = `$${prices.kurye}`;
    document.getElementById('pricePatron').textContent = `$${prices.patron}`;
    updatePriceTotal();
  } catch { /* varsayilan fiyatlarla devam */ }
}

document.getElementById('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hasKurye = document.getElementById('prodKurye').checked;
  const hasPatron = document.getElementById('prodPatron').checked;
  const hasQrmenu = document.getElementById('prodQrmenu').checked;
  const hasGelismisKurye = document.getElementById('prodGelismisKurye').checked;
  try {
    const result = await api('/api/dealer/customers', { method: 'POST', body: JSON.stringify({
      businessName: customerName.value, email: customerEmail.value, phone: customerPhone.value, hasKurye, hasPatron, hasQrmenu, hasGelismisKurye
    }) });
    e.target.reset();
    updatePriceTotal();
    const box = document.getElementById('activationResult');
    box.hidden = false;
    box.innerHTML = `<div class="ok">Oluşturuldu (toplam $${result.totalUsd}). Aktivasyon anahtarı (kurulum sırasında bu restoranın bilgisayarına girilecek):<br><b style="font-size:16px;letter-spacing:1px">${esc(result.activationKey)}</b></div>`;
    loadCustomers();
  } catch (err) { alert(err.message); }
});

function productsLabel(c) {
  const parts = [];
  if (c.has_kurye) parts.push('Kurye');
  if (c.has_patron) parts.push('Patron');
  if (c.has_qrmenu) parts.push('QR Menü');
  if (c.has_gelismis_kurye) parts.push('Gelişmiş Kurye');
  if (c.has_ultra_paketci) parts.push('Ultra Gelişmiş Kurye');
  return parts.join(' + ') || '—';
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

let customersCache = [];

async function loadCustomers() {
  const { customers, quota, used } = await api('/api/dealer/customers');
  customersCache = customers;
  const quotaBox = document.getElementById('quotaInfo');
  quotaBox.textContent = quota != null ? `Lisans kotanız: ${used} / ${quota} kullanıldı.` : '';
  document.getElementById('restGrid').innerHTML = customers.map(c => `
    <div class="rest-card">
      <div class="rest-top">
        <div>
          <div class="rest-name">${esc(c.business_name)}</div>
          <div class="rest-sub">
            <span class="rest-key" data-copy-key="${esc(c.activation_key)}" title="Kopyalamak için tıklayın">${esc(c.activation_key)}</span>
          </div>
        </div>
        <div class="rest-badges">
          <span class="badge ${c.subscription_status}">${c.subscription_status === 'active' ? 'Aktif' : 'Askıda'}</span>
          ${c.licenseExpired ? '<span class="badge suspended">Süresi doldu</span>' : ''}
          <span class="rest-conn"><span class="dot ${c.connected ? 'on' : ''}"></span>${c.connected ? 'Bağlı' : 'Bağlı değil'}</span>
        </div>
      </div>

      <div class="pill-row">
        <button class="pill${c.has_kurye ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasKurye" data-on="${c.has_kurye ? 0 : 1}" data-label="Kurye Bulut">🛵 Kurye</button>
        <button class="pill${c.has_patron ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasPatron" data-on="${c.has_patron ? 0 : 1}" data-label="Patron Raporu">📊 Patron</button>
        <button class="pill${c.has_qrmenu ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasQrmenu" data-on="${c.has_qrmenu ? 0 : 1}" data-label="QR Menü">🍽️ QR Menü</button>
        <button class="pill${c.has_gelismis_kurye ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasGelismisKurye" data-on="${c.has_gelismis_kurye ? 0 : 1}" data-label="Gelişmiş Kurye">⚡ Gelişmiş Kurye${c.has_gelismis_kurye ? ` <span class="dot${c.gkConnected ? ' on' : ''}" title="${c.gkConnected ? 'Bağlı' : 'Bağlı değil'}"></span>` : ''}</button>
        <button class="pill${c.has_ultra_paketci ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasUltraPaketci" data-on="${c.has_ultra_paketci ? 0 : 1}" data-label="Ultra Gelişmiş Kurye">🚀 Ultra Gelişmiş Kurye${c.has_ultra_paketci ? ` <span class="dot${c.ultraConnected ? ' on' : ''}" title="${c.ultraConnected ? 'Bağlı' : 'Bağlı değil'}"></span>` : ''}</button>
        <button class="pill${c.has_kiosk ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasKiosk" data-on="${c.has_kiosk ? 0 : 1}" data-label="Kiosk">🖥️ Kiosk</button>
      </div>
      ${c.has_gelismis_kurye && c.gk_activation_key ? `<div class="rest-sub">Gelişmiş Kurye anahtarı: <span class="rest-key" data-copy-key="${esc(c.gk_activation_key)}" title="Kopyalamak için tıklayın">${esc(c.gk_activation_key)}</span></div>` : ''}
      ${c.has_ultra_paketci && c.ultra_activation_key ? `<div class="rest-sub">Ultra Gelişmiş Kurye anahtarı (AYRI): <span class="rest-key" data-copy-key="${esc(c.ultra_activation_key)}" title="Kopyalamak için tıklayın">${esc(c.ultra_activation_key)}</span></div>` : ''}
      ${c.has_kiosk && c.kiosk_activation_key ? `<div class="rest-sub">Kiosk anahtarı (AYRI kiosk lisansı): <span class="rest-key" data-copy-key="${esc(c.kiosk_activation_key)}" title="Kopyalamak için tıklayın">${esc(c.kiosk_activation_key)}</span></div>` : ''}

      <details class="rest-edit">
        <summary></summary>
        <div class="field-grid">
          <input value="${esc(c.business_name)}" data-name-input="${c.id}" placeholder="İşletme adı">
          <input type="email" value="${esc(c.email || '')}" data-email-input="${c.id}" placeholder="E-posta (opsiyonel)">
          <input type="tel" value="${esc(c.phone || '')}" data-phone-input="${c.id}" placeholder="Telefon">
        </div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">
          <button class="btn small" data-save-name="${c.id}">Bilgileri Kaydet</button>
        </div>
        <div class="row" style="margin-top:8px">
          <input type="text" data-password-input="${c.id}" placeholder="Yeni şifre" style="flex:1">
          <button class="btn small" data-set-password="${c.id}">Şifreyi Değiştir</button>
        </div>
      </details>

      <div class="rest-foot">
        <span>Son giriş: ${timeAgo(c.last_login_at)}</span>
        <div class="row">
          <input type="date" value="${esc(c.license_expires_at || '')}" data-license-input="${c.id}">
          <button class="btn small" data-save-license="${c.id}">Kaydet</button>
        </div>
        <div class="row">
          <button class="btn small" data-toggle-status="${c.id}" data-status="${c.subscription_status === 'active' ? 'suspended' : 'active'}">${c.subscription_status === 'active' ? 'Askıya al' : 'Aktif et'}</button>
          <button class="btn small" data-view="${c.id}">Özeti gör</button>
        </div>
      </div>
    </div>`
  ).join('') || '<p class="muted">Henüz size atanmış restoran yok.</p>';

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => showSummary(Number(btn.dataset.view)));
  });
  document.querySelectorAll('[data-copy-key]').forEach(td => {
    td.addEventListener('click', () => {
      navigator.clipboard.writeText(td.dataset.copyKey).then(() => {
        const old = td.textContent;
        td.textContent = 'Kopyalandı ✓';
        setTimeout(() => { td.textContent = old; }, 1200);
      }).catch(() => {});
    });
  });
  document.querySelectorAll('[data-toggle-product]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.toggleProduct);
      const card = btn.closest('.rest-card');
      try {
        const body = {
          id, businessName: card.querySelector('[data-name-input]').value, email: card.querySelector('[data-email-input]').value,
          phone: card.querySelector('[data-phone-input]').value
        };
        body[btn.dataset.field] = Number(btn.dataset.on) === 1;
        const result = await api('/api/dealer/customers/update', { method: 'POST', body: JSON.stringify(body) });
        if (result.gkActivationKey) alert(`Gelişmiş Kurye için YENİ, AYRI bir aktivasyon anahtarı üretildi:\n\n${result.gkActivationKey}\n\nBu anahtarı müşteriye verin - diğer ürünlerin anahtarıyla KARIŞTIRMAYIN.`);
        if (result.ultraActivationKey) alert(`Ultra Gelişmiş Kurye için YENİ, AYRI bir aktivasyon anahtarı üretildi:\n\n${result.ultraActivationKey}\n\nBu anahtarı müşteriye verin - diğer ürünlerin anahtarıyla KARIŞTIRMAYIN.`);
        if (result.kioskActivationKey) alert(`Kiosk için YENİ, AYRI bir kiosk lisans anahtarı üretildi:\n\n${result.kioskActivationKey}\n\nBu anahtarı müşteriye verin - diğer ürünlerin anahtarıyla KARIŞTIRMAYIN.`);
        loadCustomers();
      } catch (err) { alert(err.message); }
    });
  });
  document.querySelectorAll('[data-save-name]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.saveName);
      const card = btn.closest('.rest-card');
      try {
        await api('/api/dealer/customers/update', { method: 'POST', body: JSON.stringify({
          id, businessName: card.querySelector('[data-name-input]').value, email: card.querySelector('[data-email-input]').value,
          phone: card.querySelector('[data-phone-input]').value
        }) });
        loadCustomers();
      } catch (err) { alert(err.message); }
    });
  });
  document.querySelectorAll('[data-set-password]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.setPassword);
      const row = customersCache.find(c => c.id === id);
      const input = document.querySelector(`[data-password-input="${id}"]`);
      if (!input.value) { alert('Yeni şifre girin.'); return; }
      if (!confirm(`${row ? row.business_name : 'Bu restoranın'} şifresi "${input.value}" olarak değiştirilsin mi?`)) return;
      try {
        await api('/api/dealer/customers/set-password', { method: 'POST', body: JSON.stringify({ id, password: input.value }) });
        alert('Şifre değiştirildi.');
        input.value = '';
      } catch (err) { alert(err.message); }
    });
  });
  document.querySelectorAll('[data-save-license]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.saveLicense);
      const input = document.querySelector(`[data-license-input="${id}"]`);
      try {
        await api('/api/dealer/customers/license', { method: 'POST', body: JSON.stringify({ id, licenseExpiresAt: input.value }) });
        loadCustomers();
      } catch (err) { alert(err.message); }
    });
  });
  document.querySelectorAll('[data-toggle-status]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.toggleStatus);
      const row = customersCache.find(c => c.id === id);
      const status = btn.dataset.status;
      if (status === 'suspended' && !confirm(`${row ? row.business_name : 'Bu restoran'} askıya alınsın mı?`)) return;
      try {
        await api('/api/dealer/customers/status', { method: 'POST', body: JSON.stringify({ id, status }) });
        loadCustomers();
      } catch (err) { alert(err.message); }
    });
  });
}

async function loadProfile() {
  try {
    const p = await api('/api/dealer/profile');
    document.getElementById('profileName').value = p.name || '';
    document.getElementById('profilePhone').value = p.phone || '';
    document.getElementById('profileWebsite').value = p.website || '';
  } catch { /* sessizce gec */ }
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('profileMsg');
  msg.textContent = '';
  try {
    await api('/api/dealer/profile', { method: 'POST', body: JSON.stringify({
      name: profileName.value, phone: profilePhone.value, website: profileWebsite.value
    }) });
    msg.textContent = 'Kaydedildi ✓';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  } catch (err) { msg.textContent = err.message; }
});

async function showSummary(id) {
  const box = document.getElementById('summaryBox');
  box.hidden = false;
  box.innerHTML = '<p class="muted">Yükleniyor…</p>';
  try {
    const result = await api(`/api/dealer/customer-summary?id=${id}`);
    box.innerHTML = `<h2>${esc(result.businessName)}</h2>` + renderSnapshot(result.data, result.updatedAt);
  } catch (err) {
    box.innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

api('/api/dealer/customers').then(() => { loginView.hidden = true; appView.hidden = false; loadCustomers(); loadPrices(); }).catch(() => {});

/* Indirme butonlarina tiklandiginda sayaci sessizce arttirir (admin panelde
   "kac indirme" gorebilmek icin) - indirmeyi geciktirmez/engellemez. */
document.querySelectorAll('a[data-track-download]').forEach(a => {
  a.addEventListener('click', () => {
    fetch('/api/track/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: a.dataset.trackDownload }) }).catch(() => {});
  });
});
