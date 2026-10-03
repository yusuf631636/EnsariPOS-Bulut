/* Musteri ozet verisini (agent push payload'i) hem musteri hem bayi panelinde
   ayni sekilde kart olarak cizen ortak fonksiyon. */
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(n) { return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'; }

function renderSnapshot(data, updatedAt) {
  if (!data) return '<p class="muted">Henüz veri gelmedi. Restoran bilgisayarındaki program çalıştığında birkaç saniye içinde burada görünecek.</p>';
  const s = (data.sales && data.sales.summary) || {};
  const payments = (data.sales && data.sales.payments) || [];
  const tables = (data.openTables && data.openTables.tables) || [];
  const pending = (data.openTables && data.openTables.packages && data.openTables.packages.pending) || [];
  const enroute = (data.openTables && data.openTables.packages && data.openTables.packages.enroute) || [];
  const courierOrders = (data.courier && data.courier.orders) || [];
  const deliverySummary = (data.courier && data.courier.deliverySummary) || [];
  const age = updatedAt ? Math.round((Date.now() - Number(updatedAt)) / 1000) : null;
  // Patron Raporu ajani bunlari ZATEN buluta gonderiyor (bkz. C:\ensari\server.js
  // report()) - sadece daha once burada gosterilmiyordu.
  const products = (data.sales && data.sales.products) || [];
  const hourly = (data.sales && data.sales.hourly) || [];
  const departments = (data.sales && data.sales.departments) || [];
  const users = (data.sales && data.sales.users) || [];
  const recent = (data.sales && data.sales.recent) || [];
  const notifications = (data.notifications && Array.isArray(data.notifications)) ? data.notifications : [];

  /* Kurye bazli kirilim: su anki aktif siparisler (courierOrders) + bugunku
     teslimat ozeti (deliverySummary) tek tabloda birlestirilir. */
  const byCourier = {};
  courierOrders.forEach(o => {
    const bucket = byCourier[o.courierName] || (byCourier[o.courierName] = { pending: 0, enroute: 0, deliveredCount: 0, deliveredTotal: 0 });
    if (o.packageStatus === 'Yolda') bucket.enroute++; else bucket.pending++;
  });
  deliverySummary.forEach(row => {
    const bucket = byCourier[row.courier_name] || (byCourier[row.courier_name] = { pending: 0, enroute: 0, deliveredCount: 0, deliveredTotal: 0 });
    bucket.deliveredCount = row.count || 0;
    bucket.deliveredTotal = row.total || 0;
  });
  const courierNames = Object.keys(byCourier).sort();

  /* Her mantiksal blok bir "snap-section" ile etiketlenir - bugune kadar hep
     TEK uzun sayfa olarak gorunuyordu, degisen bir sey yok (varsayilan olarak
     hepsi gorunur kalir). Patron2 paneli gibi sekmeli bir tuketici, sadece
     CSS ile istedigi data-section'i gosterip digerlerini gizleyebilir - bu
     fonksiyonun ciktisi/mantigi degismez, sadece grup grup etiketlenir. */
  return `
    <div class="row" style="margin-bottom:14px">
      <span class="muted">${age !== null ? (age < 90 ? `${age} sn önce güncellendi` : `${Math.round(age / 60)} dk önce güncellendi (bağlantı kesilmiş olabilir)`) : ''}</span>
    </div>
    <div class="snap-section" data-section="genel">
    <div class="card-grid">
      <div class="stat" style="background:var(--s1);color:#06121f"><div class="n">${money((Number(s.sales) || 0) + (Number(s.remaining) || 0))}</div><div class="l">Toplam ciro (tahsil edilen + açık)</div></div>
      <div class="stat"><div class="n">${money(s.sales)}</div><div class="l">Tahsil edilen (kapanmış)</div></div>
      <div class="stat"><div class="n">${money(s.remaining)}</div><div class="l">Açık bakiye (henüz ödenmemiş)</div></div>
      <div class="stat"><div class="n">${s.tickets ?? '—'}</div><div class="l">Adisyon sayısı</div></div>
      <div class="stat"><div class="n">${money(s.average)}</div><div class="l">Ortalama fiş</div></div>
    </div>
    ${payments.length ? `
    <div class="card">
      <h2>Tahsilat Dağılımı</h2>
      <div class="card-grid">
        ${payments.map(p => `<div class="stat"><div class="n">${money(p.amount)}</div><div class="l">${escHtml(p.name)} (${escHtml(p.count)} ödeme)</div></div>`).join('')}
        <div class="stat" style="background:var(--s1);color:#06121f"><div class="n">${money(payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0))}</div><div class="l">Toplam tahsilat</div></div>
      </div>
    </div>` : ''}
    ${notifications.length ? `
    <div class="card">
      <h2>Bildirimler</h2>
      <table><thead><tr><th>Tür</th><th>Tarih</th><th>Fiş</th><th>Tutar</th><th>Detay</th></tr></thead><tbody>
        ${notifications.map(n => `<tr><td>${escHtml(n.kind)}</td><td>${escHtml(n.date)}</td><td>${escHtml(n.ticket)}</td><td>${money(n.amount)}</td><td>${escHtml(n.detail)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    </div>
    <div class="snap-section" data-section="acik">
    <div class="card-grid">
      <div class="stat"><div class="n">${tables.length}</div><div class="l">Açık masa</div></div>
      <div class="stat"><div class="n">${pending.length}</div><div class="l">Bekleyen paket</div></div>
      <div class="stat"><div class="n">${enroute.length}</div><div class="l">Yoldaki paket</div></div>
    </div>
    ${tables.length || pending.length || enroute.length ? `
    <div class="card">
      <h2>Açık Adisyonlar (Masa / Paket)</h2>
      <p class="muted" style="margin:0 0 10px">İçini görmek için bir satıra dokunun (restoran bilgisayarı açıksa birkaç saniye içinde gelir).</p>
      <table><thead><tr><th>Tür</th><th>Masa/Fiş</th><th>Personel</th><th>Tutar</th><th>Kalan</th></tr></thead><tbody>
        ${tables.map(t => `<tr class="ticket-row" data-ticket-id="${escHtml(t.id)}" data-ticket-label="${escHtml(t.table)}"><td>Masa</td><td>${escHtml(t.table)}${t.number ? ' · ' + escHtml(t.number) : ''}</td><td>${escHtml(t.user)}</td><td>${money(t.total)}</td><td>${money(t.remaining)}</td></tr>`).join('')}
        ${pending.map(p => `<tr class="ticket-row" data-ticket-id="${escHtml(p.id)}" data-ticket-label="${escHtml(p.table)}"><td>Paket (bekliyor)</td><td>${escHtml(p.table)}${p.number ? ' · ' + escHtml(p.number) : ''}</td><td>${escHtml(p.user)}</td><td>${money(p.total)}</td><td>${money(p.remaining)}</td></tr>`).join('')}
        ${enroute.map(p => `<tr class="ticket-row" data-ticket-id="${escHtml(p.id)}" data-ticket-label="${escHtml(p.table)}"><td>Paket (yolda)</td><td>${escHtml(p.table)}${p.number ? ' · ' + escHtml(p.number) : ''}</td><td>${escHtml(p.user)}</td><td>${money(p.total)}</td><td>${money(p.remaining)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : '<p class="muted">Şu an açık masa/paket yok.</p>'}
    </div>
    <div class="snap-section" data-section="kurye">
    ${data.courier ? `
    <div class="card">
      <h2>Kuryeler</h2>
      <table><thead><tr><th>Kurye</th><th>Bekliyor</th><th>Yolda</th><th>Bugün teslim</th><th>Tahsilat</th></tr></thead><tbody>
        ${courierNames.map(name => `<tr><td>${escHtml(name)}</td><td>${byCourier[name].pending}</td><td>${byCourier[name].enroute}</td><td>${byCourier[name].deliveredCount}</td><td>${money(byCourier[name].deliveredTotal)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aktif kurye yok</td></tr>'}
      </tbody></table>
    </div>` : ''}
    </div>
    <div class="snap-section" data-section="urun">
    ${products.length ? `
    <div class="card">
      <h2>En Çok Satan Ürünler</h2>
      <div class="bar-chart" style="margin-bottom:16px">
        ${(() => { const max = Math.max(...products.map(p => Number(p.amount) || 0), 1); return products.slice(0, 10).map(p => `
        <div class="bar-row" style="grid-template-columns:1fr 2fr auto">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.name)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round((Number(p.amount) || 0) / max * 100))}%"></div></div>
          <span class="n">${money(p.amount)}</span>
        </div>`).join(''); })()}
      </div>
      <table><thead><tr><th>Ürün</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>
        ${products.map(p => `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.quantity)}</td><td>${money(p.amount)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    ${departments.length ? `
    <div class="card">
      <h2>Departman Bazlı Satış</h2>
      <table><thead><tr><th>Departman</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>
        ${departments.map(d => `<tr><td>${escHtml(d.name)}</td><td>${escHtml(d.count)}</td><td>${money(d.amount)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    ${users.length ? `
    <div class="card">
      <h2>Personel Bazlı Satış</h2>
      <table><thead><tr><th>Personel</th><th>Adisyon</th><th>Tutar</th></tr></thead><tbody>
        ${users.map(u => `<tr><td>${escHtml(u.name)}</td><td>${escHtml(u.count)}</td><td>${money(u.amount)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    </div>
    <div class="snap-section" data-section="odeme">
    <div class="card">
      <h2>Ödeme Türleri</h2>
      <table><thead><tr><th>Tür</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>
        ${payments.map(p => `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.count)}</td><td>${money(p.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Veri yok</td></tr>'}
      </tbody></table>
    </div>
    </div>
    <div class="snap-section" data-section="saatlik">
    ${hourly.length ? `
    <div class="card">
      <h2>Saatlik Dağılım</h2>
      <div class="bar-chart" style="margin-bottom:16px">
        ${(() => { const max = Math.max(...hourly.map(h => Number(h.amount) || 0), 1); return hourly.map(h => `
        <div class="bar-row">
          <span class="muted">${String(h.hour).padStart(2, '0')}:00</span>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round((Number(h.amount) || 0) / max * 100))}%"></div></div>
          <span class="n">${money(h.amount)}</span>
        </div>`).join(''); })()}
      </div>
      <table><thead><tr><th>Saat</th><th>Adisyon</th><th>Tutar</th></tr></thead><tbody>
        ${hourly.map(h => `<tr><td>${String(h.hour).padStart(2, '0')}:00</td><td>${escHtml(h.count)}</td><td>${money(h.amount)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : '<p class="muted">Veri yok</p>'}
    </div>
    <div class="snap-section" data-section="adisyon">
    ${recent.length ? `
    <div class="card">
      <h2>Son Adisyonlar</h2>
      <table><thead><tr><th>Tarih</th><th>Fiş No</th><th>Personel</th><th>Tutar</th></tr></thead><tbody>
        ${recent.map(r => `<tr><td>${escHtml(r.date)}</td><td>${escHtml(r.number)}</td><td>${escHtml(r.user)}</td><td>${money(r.amount)}</td></tr>`).join('')}
      </tbody></table>
    </div>` : ''}
    </div>`;
}
