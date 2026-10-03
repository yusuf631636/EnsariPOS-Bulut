async function api(path, options) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu.');
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const loginView = document.getElementById('login');
const appView = document.getElementById('app');
const msg = document.getElementById('msg');

function showMsg(text, isError) {
  msg.innerHTML = `<div class="${isError ? 'err' : 'ok'}">${esc(text)}</div>`;
  setTimeout(() => { msg.innerHTML = ''; }, 4000);
}

/* Ust segbar - Musteriler/Bayiler/Genel sekmeleri (customer/app.js'deki
   .seg[data-pane]/.pane deseninin BIREBIR AYNISI - tek uzun sayfa yerine
   bolumlere ayirmak icin). */
document.addEventListener('click', (e) => {
  const seg = e.target.closest('.seg[data-pane]');
  if (!seg) return;
  document.querySelectorAll('.seg[data-pane]').forEach(s => s.classList.toggle('active', s === seg));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === seg.dataset.pane));
});

/* Musteri karti varsayilan olarak KAPALI - sadece ust satir (isim/anahtar/
   rozet) gorunur, tikladiginda detay (urun butonlari/duzenleme/alt satir)
   acilir. Cok sayida restoran oldugunda tek tek scroll etmek yerine hizli
   tarama saglar. */
document.addEventListener('click', (e) => {
  const top = e.target.closest('.rest-top');
  if (!top || e.target.closest('[data-copy-key]')) return;
  const body = top.nextElementSibling;
  if (body && body.classList.contains('rest-body')) body.hidden = !body.hidden;
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('loginErr');
  errBox.hidden = true;
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
    loginView.hidden = true;
    appView.hidden = false;
    loadAll();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
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
    const result = await api('/api/admin/forgot-password', { method: 'POST', body: JSON.stringify({ email: forgotEmail.value }) });
    alert(result.message);
    document.getElementById('forgotForm').hidden = true;
    document.getElementById('loginForm').hidden = false;
    document.getElementById('forgotBtn').hidden = false;
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; }
});

let dealersCache = [];
let customersCache = [];
let smsHeadersCache = [];
let openDealerId = null;

async function loadSmsHeaders() {
  try { const { headers } = await api('/api/admin/sms-headers'); smsHeadersCache = headers; } catch { smsHeadersCache = []; }
}

function productsLabel(c) {
  const parts = [];
  if (c.has_kurye) parts.push('Kurye');
  if (c.has_patron) parts.push('Patron');
  if (c.has_qrmenu) parts.push('QR Menü');
  if (c.has_gelismis_kurye) parts.push('Gelişmiş Kurye');
  return parts.join(' + ') || '—';
}

/* "Son giris" bilgisini okunakli goreceli zamana cevirir (ornegin
   "3 saat once", "12 gun once"); hic giris yapilmamissa "-" doner. */
function timeAgo(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

const DOWNLOAD_LABELS = { kurye: 'AlfaPOS Kurye Bulut', patron: 'AlfaPOS Patron' };
async function loadDownloadStats() {
  try {
    const { downloads } = await api('/api/admin/download-stats');
    const byFile = Object.fromEntries(downloads.map(d => [d.file, d]));
    document.getElementById('downloadStats').innerHTML = Object.keys(DOWNLOAD_LABELS).map(key => {
      const row = byFile[key];
      return `<div>${DOWNLOAD_LABELS[key]}: <b>${row ? row.count : 0}</b> indirme${row ? ` · son: ${timeAgo(row.last_at)}` : ''}</div>`;
    }).join('');
  } catch { document.getElementById('downloadStats').textContent = 'Yüklenemedi.'; }
}

async function loadDealers() {
  const { dealers } = await api('/api/admin/dealers');
  dealersCache = dealers;
  document.getElementById('dealerCards').innerHTML = dealers.map(d => `
    <div class="stat" data-dealer-card="${d.id}" style="cursor:pointer${openDealerId === d.id ? ';border-color:var(--s1)' : ''}">
      <div class="n">${d.customer_count}${d.license_quota != null ? `<span class="muted" style="font-size:13px"> / ${d.license_quota}</span>` : ''}</div>
      <div class="l">${esc(d.name)} — müşteri<br><span class="muted">${esc(d.email)} · %${esc(d.commission_rate)} komisyon · son giriş: ${timeAgo(d.last_login_at)}</span></div>
    </div>`
  ).join('') || '<p class="muted">Henüz bayi yok.</p>';
  renderLicDealerOptions();

  document.querySelectorAll('[data-dealer-card]').forEach(card => {
    card.addEventListener('click', () => {
      const id = Number(card.dataset.dealerCard);
      openDealerId = openDealerId === id ? null : id;
      renderDealerDetail();
      loadDealers();
    });
  });
  renderDealerDetail();
}

function renderDealerDetail() {
  const box = document.getElementById('dealerDetail');
  if (!openDealerId) { box.hidden = true; box.innerHTML = ''; return; }
  const d = dealersCache.find(x => x.id === openDealerId);
  if (!d) { box.hidden = true; return; }
  box.hidden = false;
  const theirCustomers = customersCache.filter(c => c.dealer_id === openDealerId);
  box.innerHTML = `
    <h2>${esc(d.name)} — Detay</h2>
    <div class="field"><label>Bayi adı</label><input value="${esc(d.name)}" id="dd-name"></div>
    <div class="field"><label>E-posta</label><input type="email" value="${esc(d.email)}" id="dd-email"></div>
    <div class="field"><label>Telefon (SMS için)</label><input type="tel" value="${esc(d.phone || '')}" id="dd-phone"></div>
    <div class="field"><label>SMS başlığı</label>
      <select id="dd-header">
        <option value="">SMS başlığı seçin</option>
        ${smsHeadersCache.map(h => `<option value="${esc(h)}"${h === d.sms_header ? ' selected' : ''}>${esc(h)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Lisans kotası (boş = sınırsız) — şu an ${theirCustomers.length} müşteri var</label><input type="number" min="0" step="1" value="${d.license_quota != null ? esc(d.license_quota) : ''}" id="dd-quota"></div>
    <button class="btn primary" id="dd-save" style="width:auto;margin-right:8px">Kaydet</button>
    <button class="btn" id="dd-sms" style="width:auto">SMS Gönder (giriş bilgisi)</button>
    <div class="field" style="margin-top:16px"><label>Yeni şifre belirle (SMS gitmez, sadece burada değişir)</label>
      <div class="row"><input type="text" id="dd-password" placeholder="Yeni şifre" style="flex:1"><button class="btn" id="dd-set-password" style="width:auto;margin-left:8px">Şifreyi Değiştir</button></div>
    </div>
    <h2 style="margin-top:20px">Verdiği Lisanslar (${theirCustomers.length})</h2>
    <table><thead><tr><th>İşletme</th><th>Ürünler</th><th>Durum</th><th>Bağlantı</th></tr></thead><tbody>
      ${theirCustomers.map(c => `<tr><td>${esc(c.business_name)}</td><td>${esc(productsLabel(c))}</td><td><span class="badge ${c.subscription_status}">${c.subscription_status === 'active' ? 'Aktif' : 'Askıda'}</span></td><td><span class="dot ${c.connected ? 'on' : ''}"></span>${c.connected ? 'Bağlı' : 'Bağlı değil'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Henüz müşteri eklememiş.</td></tr>'}
    </tbody></table>
  `;
  document.getElementById('dd-save').addEventListener('click', async () => {
    try {
      const quotaInput = document.getElementById('dd-quota').value;
      await api('/api/admin/dealers/update', { method: 'POST', body: JSON.stringify({
        id: d.id, name: document.getElementById('dd-name').value, email: document.getElementById('dd-email').value,
        phone: document.getElementById('dd-phone').value, smsHeader: document.getElementById('dd-header').value,
        licenseQuota: quotaInput === '' ? null : Number(quotaInput)
      }) });
      showMsg('Bayi bilgileri güncellendi.');
      loadDealers();
    } catch (err) { showMsg(err.message, true); }
  });
  document.getElementById('dd-sms').addEventListener('click', async () => {
    const password = document.getElementById('dd-password').value;
    const warning = password
      ? `${d.name} numarasına, "${password}" şifresiyle giriş bilgileri SMS ile gönderilsin mi? (Kredi harcanır)`
      : `${d.name} numarasına giriş bilgileri SMS ile gönderilsin mi?\nDİKKAT: "Yeni şifre" kutusu boş - bu işlem bayinin şifresini YENİ, rastgele bir şifreyle DEĞİŞTİRİR ve SMS ile gönderir. (Kredi harcanır)`;
    if (!confirm(warning)) return;
    try {
      const result = await api('/api/admin/dealers/send-info-sms', { method: 'POST', body: JSON.stringify({ id: d.id, password }) });
      showMsg('SMS gönderildi, bayinin şifresi yenilendi.');
      alert(`SMS gönderildi.\n\nBayi: ${d.name}\nKullanıcı adı: ${d.email}\nYeni şifre: ${result.password}\n\n(Bu şifreyi bir daha buradan göremezsiniz - not almak isterseniz şimdi alın.)`);
    } catch (err) { showMsg(err.message, true); }
  });
  document.getElementById('dd-set-password').addEventListener('click', async () => {
    const pwInput = document.getElementById('dd-password');
    if (!pwInput.value) { showMsg('Yeni şifre girin.', true); return; }
    if (!confirm(`${d.name} bayisinin şifresi "${pwInput.value}" olarak değiştirilsin mi? (SMS gönderilmez)`)) return;
    try {
      await api('/api/admin/dealers/set-password', { method: 'POST', body: JSON.stringify({ id: d.id, password: pwInput.value }) });
      showMsg('Bayi şifresi değiştirildi.');
      pwInput.value = '';
    } catch (err) { showMsg(err.message, true); }
  });
}

/* Restoranlar listesi Aktif/Pasif/Test olarak UC AYRI gride bolunur - hepsi
   tek listede karisik durunca test/deneme kayitlarini gercek musterilerden
   ayirt etmek zorlasiyordu. Gruplama is_test bayragina (bkz. db.js, routes/
   admin.js updateCustomer) ve subscription_status'e gore yapilir; kart
   sablonu AYNI kalir, sadece hangi container'a yazildigi degisir. */
function customerCardHtml(c) {
  return `
    <div class="rest-card">
      <div class="rest-top">
        <div>
          <div class="rest-name">${esc(c.business_name)}</div>
          <div class="rest-sub">
            <span>${esc(c.dealer_name)}</span>
            <span class="rest-key" data-copy-key="${esc(c.activation_key)}" title="Kopyalamak için tıklayın">${esc(c.activation_key)}</span>
          </div>
        </div>
        <div class="rest-badges">
          ${c.is_test ? '<span class="badge">🧪 Test</span>' : ''}
          <span class="badge ${c.subscription_status}">${c.subscription_status === 'active' ? 'Aktif' : 'Askıda'}</span>
          ${c.licenseExpired ? '<span class="badge suspended">Süresi doldu</span>' : ''}
          <span class="rest-conn"><span class="dot ${c.connected ? 'on' : ''}"></span>${c.connected ? 'Bağlı' : 'Bağlı değil'}</span>
        </div>
      </div>

      <div class="rest-body" hidden>
      <div class="pill-row">
        <button class="pill${c.has_kurye ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasKurye" data-on="${c.has_kurye ? 0 : 1}" data-label="Kurye Bulut">🛵 Kurye</button>
        <button class="pill${c.has_patron ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasPatron" data-on="${c.has_patron ? 0 : 1}" data-label="Patron Raporu">📊 Patron</button>
        <button class="pill${c.has_qrmenu ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasQrmenu" data-on="${c.has_qrmenu ? 0 : 1}" data-label="QR Menü">🍽️ QR Menü${c.has_qrmenu ? ` <span class="dot${c.qrmenuConnected ? ' on' : ''}" title="${c.qrmenuConnected ? 'Bağlı' : 'Bağlı değil'}"></span>` : ''}</button>
        <button class="pill${c.has_gelismis_kurye ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasGelismisKurye" data-on="${c.has_gelismis_kurye ? 0 : 1}" data-label="Gelişmiş Kurye">⚡ Gelişmiş Kurye${c.has_gelismis_kurye ? ` <span class="dot${c.gkConnected ? ' on' : ''}" title="${c.gkConnected ? 'Bağlı' : 'Bağlı değil'}"></span>` : ''}</button>
        <button class="pill${c.has_ultra_paketci ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasUltraPaketci" data-on="${c.has_ultra_paketci ? 0 : 1}" data-label="Ultra Gelişmiş Kurye">🚀 Ultra Gelişmiş Kurye${c.has_ultra_paketci ? ` <span class="dot${c.ultraConnected ? ' on' : ''}" title="${c.ultraConnected ? 'Bağlı' : 'Bağlı değil'}"></span>` : ''}</button>
        <button class="pill${c.has_kiosk ? ' on' : ''}" data-toggle-product="${c.id}" data-field="hasKiosk" data-on="${c.has_kiosk ? 0 : 1}" data-label="Kiosk">🖥️ Kiosk</button>
        <button class="pill${c.is_test ? ' on' : ''}" data-toggle-product="${c.id}" data-field="isTest" data-on="${c.is_test ? 0 : 1}" data-label="Test">🧪 Test</button>
      </div>
      ${c.has_gelismis_kurye && c.gk_activation_key ? `<div class="rest-sub">Gelişmiş Kurye anahtarı: <span class="rest-key" data-copy-key="${esc(c.gk_activation_key)}" title="Kopyalamak için tıklayın">${esc(c.gk_activation_key)}</span> · <a href="https://ornek-alanadi.com/downloads/GelismisKuryeCSharpSetup.exe" target="_blank" rel="noopener">İndir</a></div>` : ''}
      ${c.has_ultra_paketci && c.ultra_activation_key ? `<div class="rest-sub">Ultra Gelişmiş Kurye anahtarı (Gelişmiş Kurye'den AYRI): <span class="rest-key" data-copy-key="${esc(c.ultra_activation_key)}" title="Kopyalamak için tıklayın">${esc(c.ultra_activation_key)}</span> · <a href="https://ornek-alanadi.com/downloads/UltraPaketciCSharpSetup.exe" target="_blank" rel="noopener">İndir</a></div>` : ''}
      ${c.has_kiosk && c.kiosk_activation_key ? `<div class="rest-sub">Kiosk anahtarı (AYRI kiosk lisansı): <span class="rest-key" data-copy-key="${esc(c.kiosk_activation_key)}" title="Kopyalamak için tıklayın">${esc(c.kiosk_activation_key)}</span></div>` : ''}
      ${c.has_qrmenu ? `<div class="rest-sub">QR Menü anahtarı (genel aktivasyon anahtarınızla AYNI): <span class="rest-key" data-copy-key="${esc(c.activation_key)}" title="Kopyalamak için tıklayın">${esc(c.activation_key)}</span> · <a href="https://ornek-alanadi.com/downloads/AlfaPOSQRMenuYerelSetup.exe" target="_blank" rel="noopener">İndir</a></div>` : ''}

      <details class="rest-edit">
        <summary></summary>
        <div class="field-grid">
          <input value="${esc(c.business_name)}" data-name-input="${c.id}" placeholder="İşletme adı">
          <input type="email" value="${esc(c.email || '')}" data-email-input="${c.id}" placeholder="E-posta (opsiyonel)">
          <input type="tel" value="${esc(c.phone || '')}" data-phone-input="${c.id}" placeholder="Telefon (SMS için)">
          <select data-header-input="${c.id}">
            <option value="">SMS başlığı seçin</option>
            ${smsHeadersCache.map(h => `<option value="${esc(h)}"${h === c.sms_header ? ' selected' : ''}>${esc(h)}</option>`).join('')}
          </select>
        </div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">
          <button class="btn small" data-save-name="${c.id}">Bilgileri Kaydet</button>
          <button class="btn small" data-send-sms="${c.id}">SMS Gönder</button>
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
          <button class="btn small" data-toggle="${c.id}" data-status="${c.subscription_status === 'active' ? 'suspended' : 'active'}">${c.subscription_status === 'active' ? 'Askıya al' : 'Aktif et'}</button>
          ${c.subscription_status === 'suspended' ? `<button class="btn small danger" data-delete-customer="${c.id}">Sil</button>` : ''}
        </div>
      </div>
      </div>
    </div>`;
}

/* Musteriler artik durum (aktif/pasif/test) yerine BAYI adina gore
   gruplaniyor - kullanici acikca bunu istedi (durum zaten her kartin
   rozetinde/Test etiketinde goruluyor, ayri bolumlere gerek yok). Bayi
   basligi + o bayinin musteri sayisi, altinda musteri kartlari. */
async function loadCustomers() {
  const { customers } = await api('/api/admin/customers');
  customersCache = customers;

  const byDealer = new Map();
  customers.forEach(c => {
    const key = c.dealer_id;
    if (!byDealer.has(key)) byDealer.set(key, { name: c.dealer_name, items: [] });
    byDealer.get(key).items.push(c);
  });
  const groups = [...byDealer.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  document.getElementById('restGroups').innerHTML = groups.map(g => `
    <div class="dealer-group">
      <h3 class="dealer-group-title">${esc(g.name)} <span class="muted">(${g.items.length})</span></h3>
      <div class="rest-grid">${g.items.map(customerCardHtml).join('')}</div>
    </div>`).join('') || '<p class="muted">Henüz restoran yok.</p>';
  document.getElementById('restTotalCount').textContent = customers.length ? `(${customers.length})` : '';

  renderDealerDetail();
  renderLicExistingOptions();

  document.querySelectorAll('[data-copy-key]').forEach(td => {
    td.addEventListener('click', () => {
      navigator.clipboard.writeText(td.dataset.copyKey).then(() => {
        const old = td.textContent;
        td.textContent = 'Kopyalandı ✓';
        setTimeout(() => { td.textContent = old; }, 1200);
      }).catch(() => {});
    });
  });
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api('/api/admin/customers/status', { method: 'POST', body: JSON.stringify({ id: Number(btn.dataset.toggle), status: btn.dataset.status }) });
      loadCustomers();
    });
  });
  document.querySelectorAll('[data-delete-customer]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.deleteCustomer);
      const row = customers.find(c => c.id === id);
      if (!confirm(`${row ? row.business_name : 'Bu restoran'} silinsin mi? Verisi kaybolmaz, "Son Silinenler"den geri getirebilirsiniz.`)) return;
      try {
        await api('/api/admin/customers/delete', { method: 'POST', body: JSON.stringify({ id }) });
        loadCustomers();
        loadDeletedCustomers();
      } catch (err) { showMsg(err.message, true); }
    });
  });
  document.querySelectorAll('[data-toggle-product]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const card = btn.closest('.rest-card');
        const body = {
          id: Number(btn.dataset.toggleProduct), businessName: card.querySelector('[data-name-input]').value,
          email: card.querySelector('[data-email-input]').value, phone: card.querySelector('[data-phone-input]').value,
          smsHeader: card.querySelector('[data-header-input]').value
        };
        body[btn.dataset.field] = Number(btn.dataset.on) === 1;
        const result = await api('/api/admin/customers/update', { method: 'POST', body: JSON.stringify(body) });
        showMsg(`${btn.dataset.label} durumu güncellendi.`);
        if (result.gkActivationKey) alert(`Gelişmiş Kurye için YENİ, AYRI bir aktivasyon anahtarı üretildi:\n\n${result.gkActivationKey}\n\nBu anahtarı müşteriye verin - diğer ürünlerin anahtarıyla KARIŞTIRMAYIN.`);
        if (result.ultraActivationKey) alert(`Ultra Gelişmiş Kurye için YENİ, AYRI bir aktivasyon anahtarı üretildi:\n\n${result.ultraActivationKey}\n\nBu anahtarı müşteriye verin - Gelişmiş Kurye dahil diğer ürünlerin anahtarıyla KARIŞTIRMAYIN.`);
        if (result.kioskActivationKey) alert(`Kiosk için YENİ, AYRI bir kiosk lisans anahtarı üretildi:\n\n${result.kioskActivationKey}\n\nBu anahtarı müşteriye verin - diğer ürünlerin anahtarıyla KARIŞTIRMAYIN.`);
        loadCustomers();
      } catch (err) { showMsg(err.message, true); }
    });
  });
  document.querySelectorAll('[data-save-license]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.saveLicense);
      const input = document.querySelector(`[data-license-input="${id}"]`);
      try {
        await api('/api/admin/customers/license', { method: 'POST', body: JSON.stringify({ id, licenseExpiresAt: input.value }) });
        showMsg('Lisans tarihi güncellendi.');
        loadCustomers();
      } catch (err) { showMsg(err.message, true); }
    });
  });
  document.querySelectorAll('[data-save-name]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.saveName);
      const nameInput = document.querySelector(`[data-name-input="${id}"]`);
      const emailInput = document.querySelector(`[data-email-input="${id}"]`);
      const phoneInput = document.querySelector(`[data-phone-input="${id}"]`);
      const headerInput = document.querySelector(`[data-header-input="${id}"]`);
      try {
        await api('/api/admin/customers/update', { method: 'POST', body: JSON.stringify({
          id, businessName: nameInput.value, email: emailInput.value, phone: phoneInput.value, smsHeader: headerInput.value
        }) });
        showMsg('İşletme bilgileri güncellendi.');
        loadCustomers();
      } catch (err) { showMsg(err.message, true); }
    });
  });
  document.querySelectorAll('[data-send-sms]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.sendSms);
      const row = customers.find(c => c.id === id);
      // "Yeni şifre" kutusuna bir deger yazilmissa O gonderilir/atanir -
      // boylece "636363 yazdiysak o gitsin" saglanir, bos birakilirsa eski
      // davranis (hic sifresi yoksa rastgele uretilir) devam eder.
      const password = (document.querySelector(`[data-password-input="${id}"]`) || {}).value || '';
      if (!confirm(`${row ? row.business_name : 'Bu restorana'} numarasına giriş bilgilerini içeren bir SMS gönderilsin mi? (Kredi harcanır)`)) return;
      btn.disabled = true;
      try {
        const result = await api('/api/admin/customers/send-info-sms', { method: 'POST', body: JSON.stringify({ id, password }) });
        showMsg('SMS gönderildi.');
        if (result.password) alert(`SMS gönderildi.\n\nRestoran: ${row ? row.business_name : ''}\nŞifre: ${result.password}\n\n(Bu şifreyi bir daha buradan göremezsiniz - not almak isterseniz şimdi alın.)`);
      } catch (err) { showMsg(err.message, true); }
      finally { btn.disabled = false; }
    });
  });
  document.querySelectorAll('[data-set-password]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.setPassword);
      const row = customers.find(c => c.id === id);
      const input = document.querySelector(`[data-password-input="${id}"]`);
      if (!input.value) { showMsg('Yeni şifre girin.', true); return; }
      if (!confirm(`${row ? row.business_name : 'Bu restoranın'} şifresi "${input.value}" olarak değiştirilsin mi? (SMS gönderilmez)`)) return;
      try {
        await api('/api/admin/customers/set-password', { method: 'POST', body: JSON.stringify({ id, password: input.value }) });
        showMsg('Restoran şifresi değiştirildi.');
        input.value = '';
      } catch (err) { showMsg(err.message, true); }
    });
  });
}

/* Lisans sekmesi - TEK form, iki mod (Yeni Musteri / Mevcut Musteri). Eskiden
   iki ayri kutu/iki ayri alan seti vardi (kullanici "karisik" buldu, 14.09.2026)
   - simdi ayni alanlar (isim/eposta/telefon/urunler/tarih) paylasiliyor, sadece
   Bayi secici (yeni) ile Musteri secici (mevcut) ve Sifre alani (SADECE yeni
   musteride - mevcut musterinin sifresi kazayla sifirlanmasin diye kartin
   kendi "Sifreyi Degistir" akisinda kalir) mod'a gore gizlenip gosterilir. */
let licMode = 'new';

function setLicMode(mode) {
  licMode = mode;
  document.getElementById('licModeNewBtn').classList.toggle('active', mode === 'new');
  document.getElementById('licModeExistingBtn').classList.toggle('active', mode === 'existing');
  document.getElementById('licNewFields').hidden = mode !== 'new';
  document.getElementById('licExistingFields').hidden = mode !== 'existing';
  document.getElementById('licPasswordField').hidden = mode !== 'new';
  document.getElementById('activationResult').hidden = true;
  if (mode === 'new') {
    document.getElementById('licInfo').textContent = '';
    ['licName', 'licEmail', 'licPhone', 'licPassword'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('licDate').value = '';
    ['licProdKurye', 'licProdPatron'].forEach(id => document.getElementById(id).checked = true);
    ['licProdQrmenu', 'licProdGelismisKurye', 'licProdUltraPaketci', 'licProdGarson'].forEach(id => document.getElementById(id).checked = false);
  } else {
    renderLicExistingInfo();
  }
}
document.getElementById('licModeNewBtn').addEventListener('click', () => setLicMode('new'));
document.getElementById('licModeExistingBtn').addEventListener('click', () => setLicMode('existing'));

function renderLicDealerOptions() {
  const sel = document.getElementById('licDealer');
  const prev = sel.value;
  sel.innerHTML = dealersCache.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  if (prev) sel.value = prev;
}
function renderLicExistingOptions() {
  const sel = document.getElementById('licExistingCustomer');
  const prev = sel.value;
  sel.innerHTML = customersCache
    .slice()
    .sort((a, b) => a.business_name.localeCompare(b.business_name, 'tr'))
    .map(c => `<option value="${c.id}">${esc(c.business_name)} — ${esc(c.dealer_name)}</option>`).join('');
  if (prev && customersCache.some(c => String(c.id) === prev)) sel.value = prev;
  if (licMode === 'existing') renderLicExistingInfo();
}
function renderLicExistingInfo() {
  const sel = document.getElementById('licExistingCustomer');
  const c = customersCache.find(x => String(x.id) === sel.value);
  if (!c) { document.getElementById('licInfo').textContent = ''; return; }
  document.getElementById('licInfo').innerHTML = `Kayıt tarihi: ${esc((c.created_at || '').slice(0, 10)) || '—'} · Son bağlantı: ${timeAgo(c.last_login_at)} · Bayi: ${esc(c.dealer_name)}`;
  document.getElementById('licName').value = c.business_name;
  document.getElementById('licEmail').value = c.email || '';
  document.getElementById('licPhone').value = c.phone || '';
  document.getElementById('licDate').value = c.license_expires_at || '';
  document.getElementById('licProdKurye').checked = !!c.has_kurye;
  document.getElementById('licProdPatron').checked = !!c.has_patron;
  document.getElementById('licProdQrmenu').checked = !!c.has_qrmenu;
  document.getElementById('licProdGelismisKurye').checked = !!c.has_gelismis_kurye;
  document.getElementById('licProdUltraPaketci').checked = !!c.has_ultra_paketci;
  document.getElementById('licProdGarson').checked = !!c.has_garson;
}
document.getElementById('licExistingCustomer').addEventListener('change', renderLicExistingInfo);

function licProducts() {
  return {
    hasKurye: document.getElementById('licProdKurye').checked,
    hasPatron: document.getElementById('licProdPatron').checked,
    hasQrmenu: document.getElementById('licProdQrmenu').checked,
    hasGelismisKurye: document.getElementById('licProdGelismisKurye').checked,
    hasUltraPaketci: document.getElementById('licProdUltraPaketci').checked,
    hasGarson: document.getElementById('licProdGarson').checked
  };
}
function showActivationResult(html) {
  const box = document.getElementById('activationResult');
  box.hidden = false;
  box.innerHTML = `<div class="ok">${html}</div>`;
}
document.getElementById('licSaveBtn').addEventListener('click', async () => {
  const businessName = document.getElementById('licName').value.trim();
  const email = document.getElementById('licEmail').value.trim();
  const phone = document.getElementById('licPhone').value.trim();
  const licenseExpiresAt = document.getElementById('licDate').value;
  if (!businessName) { showMsg('İşletme adı gerekli.', true); return; }
  try {
    if (licMode === 'new') {
      const dealerId = Number(document.getElementById('licDealer').value);
      const password = document.getElementById('licPassword').value;
      const result = await api('/api/admin/customers', { method: 'POST', body: JSON.stringify({
        dealerId, businessName, email, phone, password, licenseExpiresAt, ...licProducts()
      }) });
      showActivationResult(`Oluşturuldu — müşteriye şu bilgileri verin:<br>
        İşletme adı: <b>${esc(result.businessName)}</b>${result.email ? `<br>E-posta: <b>${esc(result.email)}</b>` : ''}
        ${result.password ? `<br>Şifre: <b style="font-size:16px;letter-spacing:1px">${esc(result.password)}</b> (doğrudan işletme adı/e-posta + bu şifreyle giriş yapabilir)` : `<br>Şifre belirlenmedi — müşteri ilk girişte aşağıdaki aktivasyon anahtarıyla KENDİ şifresini belirleyecek.`}
        <br><br>Aktivasyon anahtarı (kurulum sırasında bu restoranın bilgisayarına/config dosyasına girilecek):<br><b style="font-size:16px;letter-spacing:1px">${esc(result.activationKey)}</b>
        ${result.gkActivationKey ? `<br><br>Gelişmiş Kurye anahtarı (diğerinden AYRI, bu ürüne özel):<br><b style="font-size:16px;letter-spacing:1px">${esc(result.gkActivationKey)}</b>` : ''}
        ${result.ultraActivationKey ? `<br><br>Ultra Gelişmiş Kurye anahtarı (diğerinden AYRI, bu ürüne özel):<br><b style="font-size:16px;letter-spacing:1px">${esc(result.ultraActivationKey)}</b>` : ''}
        ${result.gsActivationKey ? `<br><br>Garson Sistemi anahtarı (diğerinden AYRI, bu ürüne özel):<br><b style="font-size:16px;letter-spacing:1px">${esc(result.gsActivationKey)}</b>` : ''}`);
      setLicMode('new');
    } else {
      const id = Number(document.getElementById('licExistingCustomer').value);
      if (!id) return;
      const c = customersCache.find(x => x.id === id);
      const result = await api('/api/admin/customers/update', { method: 'POST', body: JSON.stringify({
        id, businessName, email, phone, smsHeader: c.sms_header || '', ...licProducts()
      }) });
      await api('/api/admin/customers/license', { method: 'POST', body: JSON.stringify({ id, licenseExpiresAt }) });
      let extra = '';
      if (result.gkActivationKey) extra += `<br><br>Gelişmiş Kurye için YENİ, AYRI bir aktivasyon anahtarı üretildi:<br><b style="font-size:16px;letter-spacing:1px">${esc(result.gkActivationKey)}</b>`;
      if (result.ultraActivationKey) extra += `<br><br>Ultra Gelişmiş Kurye için YENİ, AYRI bir aktivasyon anahtarı üretildi:<br><b style="font-size:16px;letter-spacing:1px">${esc(result.ultraActivationKey)}</b>`;
      if (result.gsActivationKey) extra += `<br><br>Garson Sistemi için YENİ, AYRI bir aktivasyon anahtarı üretildi:<br><b style="font-size:16px;letter-spacing:1px">${esc(result.gsActivationKey)}</b>`;
      showActivationResult(`Lisans güncellendi.${extra}`);
    }
    await loadCustomers();
  } catch (err) { showMsg(err.message, true); }
});

async function loadDeletedCustomers() {
  try {
    const { customers: deleted } = await api('/api/admin/customers/deleted');
    document.querySelector('#deletedTable tbody').innerHTML = deleted.map(c => `
      <tr>
        <td>${esc(c.business_name)}</td>
        <td>${esc(c.dealer_name)}</td>
        <td>${timeAgo(c.deleted_at)}</td>
        <td><button class="btn small" data-restore-customer="${c.id}">Geri getir</button></td>
      </tr>`
    ).join('') || '<tr><td colspan="4" class="muted">Silinmiş müşteri yok.</td></tr>';
    document.querySelectorAll('[data-restore-customer]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/admin/customers/restore', { method: 'POST', body: JSON.stringify({ id: Number(btn.dataset.restoreCustomer) }) });
          showMsg('Müşteri geri getirildi (askıda durumda - gerekirse aktif edin).');
          loadCustomers();
          loadDeletedCustomers();
        } catch (err) { showMsg(err.message, true); }
      });
    });
  } catch { document.querySelector('#deletedTable tbody').innerHTML = '<tr><td colspan="4" class="muted">Yüklenemedi.</td></tr>'; }
}

async function loadAll() { await loadSmsHeaders(); await Promise.all([loadDealers(), loadCustomers(), loadDownloadStats(), loadDeletedCustomers()]); }

document.getElementById('dealerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/dealers', { method: 'POST', body: JSON.stringify({
      name: dealerName.value, email: dealerEmail.value, password: dealerPassword.value, commissionRate: Number(dealerCommission.value || 0),
      licenseQuota: dealerQuota.value === '' ? null : Number(dealerQuota.value)
    }) });
    e.target.reset();
    showMsg('Bayi oluşturuldu.');
    loadDealers();
  } catch (err) { showMsg(err.message, true); }
});

// Zaten oturum acik mi diye sessizce dene.
api('/api/admin/customers').then(() => { loginView.hidden = true; appView.hidden = false; loadAll(); }).catch(() => {});
