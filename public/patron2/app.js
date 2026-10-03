/* Patron Raporu paneli v2 (patron2.ornek-alanadi.com) - 30.09.2026.
   Sekmeler: Ozet (bugun + dunle/gecen haftayla kiyas), Canli (acik masalar sure renginde, paket, kurye),
   Raporlar (hazir araliklar + onceki donemle kiyas, Excel/PDF), Menu (fiyat degistir + toplu zam), Diger.
   Veri: /api/customer/summary (ajan her 15 sn gonderir). Gecmis rapor/adisyon icerigi/fiyat komutlari restoran
   bilgisayarina kuyrukla gider (patron-hourly / patron-ticket / patron-price / patron-bulk-price) ve
   /api/customer/patron-price-status ile sonucu sorulur - restoranin SQL'ine bulut hic dogrudan baglanmaz. */
'use strict';
async function api(path, options) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu.');
  return data;
}
const $ = id => document.getElementById(id);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function money(n) { return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺'; }
function money0(n) { return Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' ₺'; }
function num(n) { return Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 }); }
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseLocal(s) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null; }
function addDays(s, n) { const d = parseLocal(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysBetween(a, b) { return Math.round((parseLocal(b) - parseLocal(a)) / 86400000) + 1; }
function dur(min) { min = Math.max(0, Math.round(min)); return min < 60 ? `${min} dk` : `${Math.floor(min / 60)} sa ${min % 60} dk`; }
const GUN = ['pazar', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi'];
const GUN3 = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
/* yuzde degisim cipi: now vs prev -> {cls, txt} */
function delta(now, prev) {
  now = Number(now) || 0; prev = Number(prev) || 0;
  if (prev <= 0) return now > 0 ? { cls: 'flat', arrow: '', txt: 'yeni' } : { cls: 'flat', arrow: '', txt: '—' };
  const p = (now - prev) / prev * 100;
  if (Math.abs(p) < 0.5) return { cls: 'flat', arrow: '＝', txt: 'aynı' };
  return { cls: p > 0 ? 'up' : 'down', arrow: p > 0 ? '▲' : '▼', txt: `%${Math.abs(p).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}` };
}

/* ------------------------------------------------------------------ tema + giris */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $('themeToggle'); if (b) b.textContent = t === 'light' ? '☀️ Açık' : '🌙 Koyu';
  try { localStorage.setItem('ensari-theme', t); } catch { /* gizli mod */ }
}
try { setTheme(localStorage.getItem('ensari-theme') || 'dark'); } catch { setTheme('dark'); }
$('themeToggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));

function switchTab(isLogin) {
  $('tabLogin').classList.toggle('active', isLogin); $('tabActivate').classList.toggle('active', !isLogin);
  $('loginForm').hidden = !isLogin; $('activateForm').hidden = isLogin; $('loginErr').hidden = true;
}
$('tabLogin').addEventListener('click', () => switchTab(true));
$('tabActivate').addEventListener('click', () => switchTab(false));
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const box = $('loginErr'); box.hidden = true; box.className = 'err';
  try { await api('/api/customer/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) }); enterApp(); }
  catch (err) { box.textContent = err.message; box.hidden = false; }
});
$('activateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const box = $('loginErr'); box.hidden = true;
  try {
    await api('/api/customer/activate', { method: 'POST', body: JSON.stringify({ activationKey: $('actKey').value, password: $('actPassword').value }) });
    switchTab(true); $('username').value = $('actKey').value;
    box.className = 'ok'; box.textContent = 'Şifreniz belirlendi, şimdi giriş yapabilirsiniz.'; box.hidden = false;
  } catch (err) { box.className = 'err'; box.textContent = err.message; box.hidden = false; }
});
async function logout() {
  if (!confirm('Çıkış yapılsın mı?')) return;
  clearInterval(pollTimer);
  try { await api('/api/customer/logout', { method: 'POST' }); } catch { /* yine de yenile */ }
  location.reload();
}
$('logoutBtn').addEventListener('click', logout);
$('exitBtn').addEventListener('click', logout);
$('refreshBtn').addEventListener('click', async () => {
  const b = $('refreshBtn'); b.classList.add('spin');
  await loadSummary();
  if (view === 'rapor' && curRep) { Object.keys(repCache).forEach(k => delete repCache[k]); runReport(); } if (view === 'menu') loadMenu();
  setTimeout(() => b.classList.remove('spin'), 400);
});

/* ------------------------------------------------------------------ sekmeler */
/* v4: her zaman ana sayfadan baslanir; diger ekranlara karttan girilir, ust bardaki ‹ ile donulur */
let view = 'ozet', repFromHome = false;
const VIEW_TITLE = { canli: 'Canlı Durum', rapor: 'Tüm Raporlar', menu: 'Fiyat Değiştir', diger: 'Bildirimler ve Ayarlar' };
function updateBackBar() {
  const inRep = view === 'rapor' && !$('raporDetail').hidden;
  $('backBar').hidden = view === 'ozet' || inRep;
  $('backTitle').textContent = VIEW_TITLE[view] || '';
}
function showView(v) {
  view = v;
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  if (v === 'rapor' && !raporLoaded) renderRaporMenu();
  if (v === 'menu' && !menuLoaded) loadMenu();
  updateBackBar();
  window.scrollTo(0, 0);
}
$('homeBack').addEventListener('click', () => showView('ozet'));
/* ana sayfa kartlarinin hedefleri: 'rep:<id>[:<aralik>]', 'canli:<sekme>', ya da ekran adi */
function goCard(t) {
  if (!t) return;
  const [kind, a, b] = t.split(':');
  if (kind === 'rep') {
    showView('rapor'); repFromHome = true; setRange(b || 'today'); openReport(a); return;
  }
  if (kind === 'canli') { canliTab = a || 'masa'; renderCanli(); }
  if (kind === 'rapor') { repFromHome = false; $('raporDetail').hidden = true; $('raporMenu').hidden = false; }
  showView(kind);
}
function setRange(key) {
  rangeKey = key;
  document.querySelectorAll('#rangePills button').forEach(x => x.classList.toggle('on', x.dataset.r === key));
  $('customBox').hidden = key !== 'custom';
}

/* ------------------------------------------------------------------ restoran bilgisayarina kuyruklu istek */
async function queueAction(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
function pollAction(id, { tries = 24, every = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const st = await api(`/api/customer/patron-price-status?id=${id}`);
        if (st.state === 'uygulandi') return resolve(st);
        if (st.state === 'hata') return reject(new Error(st.error || 'Restoran bilgisayarı hata döndürdü.'));
      } catch { /* ag hatasi - tekrar dene */ }
      if (n >= tries) return reject(new Error('Zaman aşımı — restoran bilgisayarı kapalı ya da internete bağlı değil.'));
      setTimeout(tick, every);
    };
    setTimeout(tick, 700);
  });
}

/* ------------------------------------------------------------------ canli ozet (15 sn) */
let last = null, pollTimer = null;
function enterApp() {
  $('login').hidden = true; $('app').hidden = false;
  showView(view);
  loadSummary();
  pollTimer = setInterval(loadSummary, 15000);
  setInterval(renderLiveBadge, 5000);
}
async function loadSummary() {
  try {
    const r = await api('/api/customer/summary');
    last = r;
    $('bizName').textContent = r.businessName || 'Patron Raporu';
    renderLiveBadge();
    renderOzet(); renderCanli(); renderNotifications();
  } catch (err) {
    if (/Oturum/.test(err.message)) { location.reload(); return; }
    $('ozetBox').innerHTML = `<div class="alert"><span>⚠️</span><div>${esc(err.message)}</div></div>`;
  }
}
function restNow() {
  // restoranin saati (ajan gonderdiyse) + gonderimden bu yana gecen sure
  const c = last && last.data && parseLocal(last.data.clock);
  return c ? new Date(c.getTime() + (Date.now() - Number(last.updatedAt || Date.now()))) : new Date();
}
function renderLiveBadge() {
  const b = $('liveBadge'); if (!last) return;
  const age = last.updatedAt ? Math.round((Date.now() - Number(last.updatedAt)) / 1000) : null;
  const on = age !== null && age < 90;
  b.className = 'live' + (on ? '' : ' off');
  b.querySelector('span').textContent = age === null ? 'veri yok' : on ? (age < 20 ? 'canlı' : `${age} sn önce`) : `bağlantı yok · ${dur(age / 60)} önce`;
  const n = restNow();
  const gb = (last.data && Array.isArray(last.data.notifications) ? last.data.notifications : []).find(x => x.kind === 'gun-basi' || x.kind === 'gun-sonu');
  $('bizSub').textContent = `${GUN[n.getDay()].replace(/^./, c => c.toLocaleUpperCase('tr'))} ${n.getDate()} ${n.toLocaleString('tr-TR', { month: 'long' })} · ${pad2(n.getHours())}:${pad2(n.getMinutes())}` +
    (gb ? ` · ${gb.kind === 'gun-basi' ? 'gün başı' : 'gün sonu'} ${String(gb.date).slice(11, 16)}` : '');
}

/* ------------------------------------------------------------------ OZET */
let showAllProducts = false;
function hourlySvg(today, yest) {
  const t = {}, y = {};
  (today || []).forEach(h => { t[h.hour] = Number(h.amount) || 0; });
  (yest || []).forEach(h => { y[h.hour] = Number(h.amount) || 0; });
  const hours = Object.keys(t).concat(Object.keys(y)).map(Number);
  if (!hours.length) return '<p class="empty">Bugün henüz satış yok.</p>';
  let h0 = Math.min(...hours), h1 = Math.max(...hours); if (h1 === h0) { h0 = Math.max(0, h0 - 1); h1 = Math.min(23, h1 + 1); }
  const W = 320, H = 110, L = 6, R = 6, T = 16, B = 18, n = h1 - h0;
  const max = Math.max(1, ...Object.values(t), ...Object.values(y));
  const X = h => L + (h - h0) / n * (W - L - R), Y = v => T + (1 - v / max) * (H - T - B);
  const line = obj => Array.from({ length: n + 1 }, (_, i) => `${X(h0 + i).toFixed(1)},${Y(obj[h0 + i] || 0).toFixed(1)}`).join(' ');
  const peakH = Object.keys(t).length ? Object.keys(t).map(Number).reduce((a, b) => (t[b] > t[a] ? b : a)) : null;
  const labels = []; for (let h = h0; h <= h1; h += Math.max(1, Math.ceil(n / 6))) labels.push(`<text x="${X(h) - 5}" y="${H - 4}" font-size="9" fill="var(--muted)">${pad2(h)}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
    ${Object.keys(y).length ? `<polyline fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" points="${line(y)}"/>` : ''}
    <polyline fill="none" stroke="var(--s1)" stroke-width="2.6" stroke-linejoin="round" points="${line(t)}"/>
    ${peakH !== null ? `<circle cx="${X(peakH)}" cy="${Y(t[peakH])}" r="3.5" fill="var(--s1)"/><text x="${Math.min(X(peakH) + 7, W - 110)}" y="${Math.max(Y(t[peakH]) - 3, 11)}" font-size="10" fill="var(--ink-2)">${pad2(peakH)}:00 zirve · ${money0(t[peakH])}</text>` : ''}
    ${labels.join('')}</svg>
    <div class="legend"><span><i style="background:var(--s1)"></i>bugün</span>${Object.keys(y).length ? '<span><i style="background:var(--muted)"></i>dün (bütün gün)</span>' : ''}</div>`;
}
/* v4 ana sayfa: tum ozet kartlarda; karta basinca ilgili ekran/rapor acilir (data-go) */
function dcard(go, icon, color, title, body, opt) {
  opt = opt || {};
  return `<button class="dc${opt.cls ? ' ' + opt.cls : ''}" data-go="${esc(go)}">${opt.badge ? `<span class="dbadge">${esc(opt.badge)}</span>` : ''}<div class="h"><i style="background:${color}">${icon}</i>${esc(title)}</div>${body}</button>`;
}
function rw(k, v) { return `<div class="rw"><span>${esc(k)}</span><b>${v}</b></div>`; }
function renderOzet() {
  const d = last && last.data;
  if (!d || !d.sales) { $('ozetBox').innerHTML = '<p class="empty">Henüz veri gelmedi. Restoran bilgisayarındaki Patron programı çalışınca birkaç saniye içinde burada görünür.</p>'; return; }
  const s = d.sales.summary || {}, c = d.compare, now = restNow();
  const total = (Number(s.sales) || 0) + (Number(s.remaining) || 0);
  const ot = d.openTables || {}, tables = ot.tables || [];
  const pending = ot.packages && ot.packages.pending || [], enroute = ot.packages && ot.packages.enroute || [];
  const tableSum = tables.reduce((a, t) => a + (Number(t.remaining) || 0), 0);
  const ages = tables.map(t => ({ t, m: (now - parseLocal(t.date)) / 60000 })).filter(x => isFinite(x.m)).sort((a, b) => b.m - a.m);
  const today = d.sales.range && d.sales.range.start;
  const products = d.sales.products || [], payments = d.sales.payments || [], users = d.sales.users || [], hourly = d.sales.hourly || [];
  const ntfAll = Array.isArray(d.notifications) ? d.notifications : [];
  const notes = ntfAll.filter(n => (n.kind === 'iptal' || n.kind === 'iade') && today && String(n.date) >= today);
  const iptal = notes.filter(n => n.kind === 'iptal'), iade = notes.filter(n => n.kind === 'iade');
  const sumAbs = l => l.reduce((a, n) => a + Math.abs(Number(n.amount) || 0), 0);

  // ciro karti
  let chips = `<span class="chip">${num(s.tickets)} adisyon</span>`;
  if (c && c.yesterday) {
    const dy = delta(total, (Number(c.yesterday.sales) || 0) + (Number(c.yesterday.remaining) || 0));
    chips = `<span class="chip">Dün ${esc(c.until || 'bu saat')} <b class="${dy.cls}">${dy.arrow} ${dy.txt}</b></span>` +
      (c.lastWeek ? (() => { const lw = delta(total, (Number(c.lastWeek.sales) || 0) + (Number(c.lastWeek.remaining) || 0)); return `<span class="chip">Geçen ${GUN[now.getDay()]} <b class="${lw.cls}">${lw.arrow} ${lw.txt}</b></span>`; })() : '') + chips;
  }
  const hMap = {}; hourly.forEach(h => { hMap[h.hour] = Number(h.amount) || 0; });
  const hKeys = Object.keys(hMap).map(Number);
  let spark = '';
  if (hKeys.length) {
    const h0 = Math.min(...hKeys), h1 = Math.max(now.getHours(), ...hKeys), mx = Math.max(1, ...Object.values(hMap));
    for (let h = h0; h <= h1; h++) spark += `<b class="${h === now.getHours() ? 'now' : ''}" style="height:${Math.max(4, (hMap[h] || 0) / mx * 100).toFixed(0)}%" title="${pad2(h)}:00 · ${money0(hMap[h] || 0)}"></b>`;
    spark = `<div class="spark">${spark}</div>`;
  }
  const peak = hKeys.length ? hKeys.reduce((a, b) => (hMap[b] > hMap[a] ? b : a)) : null;
  const peakCnt = peak !== null ? (hourly.find(h => h.hour === peak) || {}).count : 0;

  // kasa karti
  const payTotal = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0) || 1;
  const payColors = ['#2fd18b', '#4f8dff', '#a77bff', '#ff9a3d', '#2ec8e6', '#f5b942'];

  // son 7 gun
  let week = '';
  if (c && Array.isArray(c.days) && c.days.length && today) {
    const byD = {}; c.days.forEach(x => { byD[x.date] = x; });
    const list = []; for (let i = 6; i >= 0; i--) { const dd = addDays(today, -i); list.push({ d: dd, v: Number((byD[dd] || {}).amount) || 0, lbl: i === 0 ? 'Bugün' : GUN3[parseLocal(dd).getDay()] }); }
    const mx = Math.max(1, ...list.map(x => x.v)), sum = list.reduce((a, x) => a + x.v, 0);
    const yest = list[5];
    week = dcard('rep:gunsonu:7', '📅', 'rgba(46,200,230,.2)', 'Son 7 Gün',
      `<div class="week">${list.map((x, i) => `<div class="${i === 6 ? 't' : ''}"><b style="height:${Math.max(3, x.v / mx * 58).toFixed(0)}px" title="${money0(x.v)}"></b>${x.lbl}</div>`).join('')}</div>
       <div class="sub">7 gün toplam <b>${money0(sum)}</b> · günlük ort. ${money0(sum / 7)} · dün ${money0(yest.v)}</div>`, { cls: 'w' });
  }

  const courierCount = d.courier && Array.isArray(d.courier.deliverySummary) ? d.courier.deliverySummary.reduce((a, r) => a + (Number(r.count) || 0), 0) : null;
  const lic = last.license;
  const ntfColor = { iptal: '#ff5d6c', iade: '#ff9a3d', 'gun-basi': '#2fd18b', 'gun-sonu': '#4f8dff' };
  const ntfName = { iptal: 'Adisyon iptal', iade: 'İade', 'gun-basi': 'Gün başı', 'gun-sonu': 'Gün sonu' };

  $('ozetBox').innerHTML = `<div class="dash">
    ${dcard('rep:karsi', '💰', 'rgba(245,185,66,.22)', 'Bugünkü Ciro', `<div class="big">${money(total)}</div><div class="row2" style="margin-top:8px;gap:6px">${chips}</div>${spark}`, { cls: 'w hero' })}

    <div class="dsec">ŞU AN</div>
    ${dcard('canli:masa', '🍽', 'rgba(255,154,61,.22)', 'Açık Masa', `<div class="big">${tables.length}</div><div class="sub">${money0(tableSum)} bekliyor</div>` +
      (ages.length ? `<div class="sub">En uzun: <b class="${ages[0].m > 90 ? 'down' : ages[0].m > 45 ? 'warn' : ''}">${esc(ages[0].t.table)} · ${dur(ages[0].m)}</b></div>` : '<div class="sub">açık masa yok</div>'))}
    ${dcard('canli:paket', '🛵', 'rgba(46,200,230,.2)', 'Paket Servis', rw('Bekleyen', `<span class="warn">${pending.length}</span>`) + rw('Yolda', enroute.length) + (courierCount !== null ? rw('Bugün teslim', courierCount) : rw('Açıkta', money0((pending.concat(enroute)).reduce((a, p) => a + (Number(p.remaining) || 0), 0)))))}

    <div class="dsec">KASA</div>
    ${dcard('rep:kasa', '🗄', 'rgba(47,209,139,.2)', 'Kasa Durumu', payments.length ? payments.slice(0, 6).map((p, i) => rw(p.name, money(p.amount)) + `<div class="bar"><b style="width:${Math.max(2, p.amount / payTotal * 100).toFixed(1)}%;background:${payColors[i % payColors.length]}"></b></div>`).join('') : '<div class="sub">Bugün henüz tahsilat yok.</div>', { cls: 'w' })}
    ${dcard('rep:urun', '🥙', 'rgba(79,141,255,.2)', 'Çok Satan', products.length ? products.slice(0, 3).map(p => rw(p.name, num(p.quantity))).join('') : '<div class="sub">Henüz satış yok.</div>')}
    ${dcard('rep:personel', '🤵', 'rgba(167,123,255,.2)', 'Personel', users.length ? users.slice(0, 3).map(u => rw(u.name, money0(u.amount))).join('') : '<div class="sub">Henüz satış yok.</div>')}
    ${dcard('rep:adisyon', '🧾', 'rgba(46,200,230,.2)', 'Adisyon', `<div class="big">${num(s.tickets)}</div><div class="sub">Ortalama fiş ${money(s.average)}</div>` +
      (c && c.yesterday ? (() => { const dt = (Number(s.tickets) || 0) - (Number(c.yesterday.tickets) || 0); return `<div class="sub ${dt > 0 ? 'up' : dt < 0 ? 'down' : ''}">${dt > 0 ? `▲ ${dt} dünden fazla` : dt < 0 ? `▼ ${-dt} dünden az` : 'dünle aynı'}</div>`; })() : ''))}
    ${dcard('rep:iptal', '⚠️', 'rgba(255,93,108,.2)', 'İptal / İade', rw('İptal', `<span class="${iptal.length ? 'down' : ''}">${iptal.length} · ${money0(sumAbs(iptal))}</span>`) + rw('İade', `<span class="${iade.length ? 'warn' : ''}">${iade.length} · ${money0(sumAbs(iade))}</span>`) + '<div class="sub">ikram/zayi için dokunun</div>', { badge: notes.length || '' })}

    <div class="dsec">GEÇMİŞ</div>
    ${week}
    ${dcard('rep:saatlik', '🕔', 'rgba(167,123,255,.2)', 'Yoğun Saat', peak !== null ? `<div class="big">${pad2(peak)}:00</div><div class="sub">${money0(hMap[peak])}${peakCnt ? ' · ' + num(peakCnt) + ' adisyon' : ''}</div>` : '<div class="sub">Henüz satış yok.</div>')}
    ${dcard('rep:ikram', '🎁', 'rgba(255,154,61,.2)', 'İkram / Zayi', '<div class="sub" style="margin-top:6px">İkram, iade, zayi, iskonto ve yuvarlama raporları</div>')}

    ${dcard('diger', '🔔', 'rgba(255,93,108,.2)', 'Bildirimler', ntfAll.length ? ntfAll.slice(0, 3).map(n => `<div class="dn2"><span class="dot" style="background:${ntfColor[n.kind] || '#8d99b5'}"></span><div><b>${esc(ntfName[n.kind] || n.kind)}</b> · ${n.kind === 'iptal' || n.kind === 'iade' ? `Fiş ${esc(n.ticket)} · ${money(Math.abs(n.amount))}` : esc(n.ticket || '')}<div class="sub">${esc(String(n.date).slice(5, 16).replace('-', '.'))}${n.detail ? ' · ' + esc(String(n.detail).slice(0, 50)) : ''}</div></div></div>`).join('') : '<div class="sub">Henüz bildirim yok.</div>', { cls: 'w', badge: notes.length || '' })}

    <div class="dsec">İŞLEM</div>
    ${dcard('menu', '✏️', 'rgba(47,209,139,.2)', '', `<div><div class="big">Fiyat Değiştir</div><div class="sub">Tek ürün / toplu zam</div></div>`, { cls: 'act' })}
    ${dcard('rapor', '📑', 'rgba(79,141,255,.2)', '', `<div><div class="big">Tüm Raporlar</div><div class="sub">${REPORTS.length} rapor · tarih seçerek</div></div>`, { cls: 'act' })}
    <div class="dc w noarr act" style="cursor:default"><div class="sub">Lisans: <b class="${lic && lic.active ? 'up' : 'down'}">${lic ? (lic.active ? 'Aktif' : 'Pasif') : '—'}</b> · bitiş ${lic && lic.expiresAt ? esc(new Date(lic.expiresAt).toLocaleDateString('tr-TR')) : 'süresiz'}</div></div>
  </div>`;
}
$('ozetBox').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) goCard(b.dataset.go); });

/* ------------------------------------------------------------------ CANLI */
let canliTab = 'masa';
function ticketSheet(id, label) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet"><h3>${esc(label || 'Adisyon')}<button aria-label="Kapat">✕</button></h3><div id="shBody"><p class="empty">Restoran bilgisayarından isteniyor…</p></div></div>`;
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('h3 button')) close(); });
  document.body.appendChild(ov);
  queueAction('/api/customer/patron-ticket', { ticketId: Number(id) })
    .then(r => { if (!r.connected) ov.querySelector('#shBody').innerHTML = '<p class="empty">Restoran bilgisayarı şu an bağlı değil, bekleniyor…</p>'; return pollAction(r.id); })
    .then(st => {
      const items = st.items || [], b = ov.querySelector('#shBody'); if (!b) return;
      if (!items.length) { b.innerHTML = '<p class="empty">Bu adisyonda ürün yok (kapanmış olabilir).</p>'; return; }
      const tot = items.reduce((a, it) => a + (Number(it.total) || 0), 0);
      b.innerHTML = items.map(it => `<div class="li"><div>${num(it.quantity)} × ${esc(it.name)}${it.portion ? ` <span class="mut">${esc(it.portion)}</span>` : ''}</div><b>${money(it.total)}</b></div>`).join('') + `<div class="tot"><span>Toplam</span><span>${money(tot)}</span></div>`;
    })
    .catch(err => { const b = ov.querySelector('#shBody'); if (b) b.innerHTML = `<p class="err2">${esc(err.message)}</p>`; });
}
function renderCanli() {
  const d = last && last.data; if (!d) return;
  const now = restNow(), ot = d.openTables || {}, tables = (ot.tables || []).slice();
  const pending = ot.packages && ot.packages.pending || [], enroute = ot.packages && ot.packages.enroute || [];
  const cOrders = d.courier && d.courier.orders || [], cSum = d.courier && d.courier.deliverySummary || [];
  const byC = {};
  cOrders.forEach(o => { const b = byC[o.courierName] || (byC[o.courierName] = { p: 0, y: 0, n: 0, t: 0 }); if (o.packageStatus === 'Yolda') b.y++; else b.p++; });
  cSum.forEach(r => { const b = byC[r.courier_name] || (byC[r.courier_name] = { p: 0, y: 0, n: 0, t: 0 }); b.n = r.count || 0; b.t = r.total || 0; });
  const cNames = Object.keys(byC).sort();
  $('canliTabs').innerHTML = `<button data-t="masa" class="${canliTab === 'masa' ? 'on' : ''}">Masalar ${tables.length}</button><button data-t="paket" class="${canliTab === 'paket' ? 'on' : ''}">Paket ${pending.length + enroute.length}</button>` +
    (d.courier ? `<button data-t="kurye" class="${canliTab === 'kurye' ? 'on' : ''}">Kuryeler ${cNames.length}</button>` : '');
  const age = t => (now - parseLocal(t.date)) / 60000;
  const all = tables.concat(pending, enroute), openSum = all.reduce((a, t) => a + (Number(t.remaining) || 0), 0);
  const tAges = tables.map(age).filter(isFinite), avgAge = tAges.length ? tAges.reduce((a, b) => a + b, 0) / tAges.length : 0;
  let html = `<div class="kpis" style="margin-bottom:12px">
    <div class="k"><div class="n">${money(openSum)}</div><div class="l">Açıkta bekleyen tutar</div></div>
    <div class="k"><div class="n">${tAges.length ? dur(avgAge) : '—'}</div><div class="l">Ortalama masa süresi</div></div></div>`;
  if (canliTab === 'masa') {
    tables.sort((a, b) => age(b) - age(a));
    html += tables.length ? `<div class="tiles">${tables.map(t => { const m = age(t); return `<button class="tile ${m > 90 ? 'c' : m > 45 ? 'w' : ''}" data-id="${esc(t.id)}" data-l="${esc(t.table)}">
        <div class="t">${esc(t.table)}</div><div class="a">${money(t.total)}</div><div class="m">${isFinite(m) ? dur(m) : ''}${t.user ? ' · ' + esc(t.user) : ''}${Number(t.remaining) !== Number(t.total) ? ' · kalan ' + money(t.remaining) : ''}</div></button>`; }).join('')}</div>
        <p class="note">Renk: yeşil 45 dk altı, sarı 45–90 dk, kırmızı 90 dk üstü açık. İçeriği görmek için masaya dokunun.</p>` : '<p class="empty">Şu an açık masa yok.</p>';
  } else if (canliTab === 'paket') {
    const row = (p, yolda) => { const m = age(p); return `<div class="li" data-id="${esc(p.id)}" data-l="${esc(p.table)}" style="cursor:pointer"><div><b>${esc(p.table)}</b>${p.number ? ` <span class="mut">#${esc(p.number)}</span>` : ''}<div class="m">${isFinite(m) ? (yolda ? 'yolda' : 'bekliyor') + ' · ' + dur(m) : ''} · ${money(p.total)}</div></div><span class="badge ${yolda ? 'b-y' : m > 30 ? 'b-r' : 'b-w'}">${yolda ? 'Yolda' : 'Bekliyor'}</span></div>`; };
    html += pending.length + enroute.length ? `<div class="box">${pending.map(p => row(p, false)).join('')}${enroute.map(p => row(p, true)).join('')}</div>` : '<p class="empty">Şu an açık paket yok.</p>';
  } else {
    html += cNames.length ? `<div class="box">${cNames.map(n => `<div class="li"><div>${esc(n)}<div class="m">bekliyor ${byC[n].p} · yolda ${byC[n].y} · bugün ${byC[n].n} teslimat</div></div><b class="r">${money(byC[n].t)}</b></div>`).join('')}</div>` : '<p class="empty">Aktif kurye yok.</p>';
  }
  $('canliBox').innerHTML = html;
}
$('canliTabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (b) { canliTab = b.dataset.t; renderCanli(); } });
$('canliBox').addEventListener('click', e => { const t = e.target.closest('[data-id]'); if (t) ticketSheet(t.dataset.id, t.dataset.l); });

/* ------------------------------------------------------------------ RAPORLAR (v3: Samba Patron tarzi rapor menusu) */
const REPORTS = [
  { id: 'kasa', icon: '🗄', name: 'Kasa Raporu' },
  { id: 'karsi', icon: '📊', name: 'Genel Karşılaştırma', sub: 'önceki dönemle' },
  { id: 'gunsonu', icon: '🌓', name: 'Gün Sonu Raporu', sub: 'günlük özetler' },
  { id: 'urun', icon: '🥗', name: 'Ürün Satış Raporu' },
  { id: 'saatlik', icon: '📈', name: 'Saatlik Ciro Oranları' },
  { id: 'saaturun', icon: '🕓', name: 'Saatlik Ürün Satış', extra: true },
  { id: 'personel', icon: '📉', name: 'Personel Satış Oranları' },
  { id: 'tahsilat', icon: '💳', name: 'Kullanıcı Tahsilat Raporu', extra: true },
  { id: 'departman', icon: '💰', name: 'Departman Raporu' },
  { id: 'iskonto', icon: '💱', name: 'İskonto ve Yuvarlama', extra: true },
  { id: 'ikram', icon: '📜', name: 'İkram - İade - Zayi', extra: true },
  { id: 'iptal', icon: '📛', name: 'İptal / İade Adisyonlar' },
  { id: 'paketci', icon: '🛵', name: 'Paketçi Raporu', extra: true },
  { id: 'adisyon', icon: '🧾', name: 'Adisyon Listesi' }
];
let raporLoaded = false, rangeKey = 'today', raporSeq = 0, curRep = null, lastReport = null;
const repCache = {};
function renderRaporMenu() {
  raporLoaded = true;
  $('raporMenu').innerHTML = `<div class="quick">
      <button data-go="menu">🏷<span>Fiyatlar</span></button><button data-go="ozet">🏢<span>Anlık durum</span></button><button data-go="canli">🍽<span>Açık masalar</span></button></div>` +
    REPORTS.map(r => `<button class="rbtn" data-rep="${r.id}"><i>${r.icon}</i><span>${esc(r.name)}</span>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</button>`).join('');
}
$('raporMenu').addEventListener('click', e => {
  const q = e.target.closest('[data-go]'); if (q) { if (q.dataset.go === 'canli') canliTab = 'masa'; showView(q.dataset.go); return; }
  const b = e.target.closest('[data-rep]'); if (b) { repFromHome = false; openReport(b.dataset.rep); }
});
$('rBack').addEventListener('click', () => {
  curRep = null; $('raporDetail').hidden = true; $('raporMenu').hidden = false;
  if (repFromHome) { repFromHome = false; showView('ozet'); return; }
  updateBackBar(); window.scrollTo(0, 0);
});
function openReport(id) {
  curRep = REPORTS.find(r => r.id === id); if (!curRep) return;
  $('rTitle').textContent = curRep.name;
  $('raporMenu').hidden = true; $('raporDetail').hidden = false; updateBackBar(); window.scrollTo(0, 0);
  runReport();
}
(function initRange() {
  const opts = '<option value="">—</option>' + Array.from({ length: 24 }, (_, h) => `<option value="${h}">${pad2(h)}:00</option>`).join('');
  $('rHs').innerHTML = opts; $('rHe').innerHTML = opts;
  const t = ymd(new Date()); $('rStart').value = addDays(t, -6); $('rEnd').value = t;
})();
function baseToday() { return (last && last.data && last.data.sales && last.data.sales.range && last.data.sales.range.start) || ymd(new Date()); }
function rangeFor(key) {
  const t = baseToday();
  if (key === 'today') return { start: t, end: t, label: 'Bugün', prevLabel: 'dün' };
  if (key === 'yesterday') { const y = addDays(t, -1); return { start: y, end: y, label: 'Dün', prevLabel: 'önceki gün' }; }
  if (key === '7') return { start: addDays(t, -6), end: t, label: 'Son 7 gün', prevLabel: 'önceki 7 gün' };
  if (key === '30') return { start: addDays(t, -29), end: t, label: 'Son 30 gün', prevLabel: 'önceki 30 gün' };
  if (key === 'month') return { start: t.slice(0, 8) + '01', end: t, label: 'Bu ay', prevLabel: 'geçen ayın aynı günleri' };
  const s = $('rStart').value, e = $('rEnd').value;
  return { start: s, end: e, label: `${s} — ${e}`, prevLabel: 'önceki dönem', hs: $('rHs').value, he: $('rHe').value || $('rHs').value };
}
function prevRange(r) {
  if (rangeKey === 'month') { const d = parseLocal(r.start); d.setMonth(d.getMonth() - 1); const s = ymd(d); return { start: s, end: addDays(s, daysBetween(r.start, r.end) - 1) }; }
  const n = daysBetween(r.start, r.end); return { start: addDays(r.start, -n), end: addDays(r.start, -1) };
}
$('rangePills').addEventListener('click', e => {
  const b = e.target.closest('button[data-r]'); if (!b) return;
  rangeKey = b.dataset.r;
  document.querySelectorAll('#rangePills button').forEach(x => x.classList.toggle('on', x === b));
  $('customBox').hidden = rangeKey !== 'custom';
  if (rangeKey !== 'custom' && curRep) runReport();
});
$('rGo').addEventListener('click', () => { if (curRep && $('rStart').value && $('rEnd').value && $('rStart').value <= $('rEnd').value) runReport(); });
/* ayni aralik 60 sn icinde tekrar istenirse onbellekten (rapor menusunde gezinirken restoran bilgisayarini yormasin) */
async function fetchReport(start, end, hs, he) {
  const key = [start, end, hs || '', he || ''].join('|'), c = repCache[key];
  if (c && Date.now() - c.at < 60000) return c.data;
  const q = await queueAction('/api/customer/patron-hourly', { start, end, hourStart: hs === '' || hs === undefined ? null : hs, hourEnd: he === '' || he === undefined ? null : he, extra: true });
  if (!q.connected) { const b = $('raporBox'); if (b) b.innerHTML = '<p class="empty">Restoran bilgisayarı şu an bağlı değil, bekleniyor…</p>'; }
  const st = await pollAction(q.id, { tries: 30 });
  repCache[key] = { at: Date.now(), data: st.data };
  return st.data;
}
function trDate(s) { const d = parseLocal(s); return d ? d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : s; }
function rhead(r) {
  return `<div class="rhead">${esc(trDate(r.start))}${r.end !== r.start ? ' — ' + esc(trDate(r.end)) : ''}<small>${esc(r.label)}${r.hs ? ` · ${pad2(r.hs)}:00–${pad2(r.he || r.hs)}:59` : ''}</small></div>`;
}
/* Samba tarzi tablo: mavi baslik, satirlar, istege bagli % sutunu ve toplam satiri */
function stb(title, head, rows, total) {
  return `<div class="stb"><div class="th">${esc(title)}</div>${rows.length ? `<table>${head ? `<tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>` : ''}${rows.join('')}${total ? `<tr class="tsum">${total.map(c => `<td>${c}</td>`).join('')}</tr>` : ''}</table>` : '<div class="none">Bu aralıkta kayıt yok.</div>'}</div>`;
}
function pctRows(items, label, val, fmt) {
  const sum = items.reduce((a, x) => a + (Number(x[val]) || 0), 0) || 1;
  return items.map(x => { const p = (Number(x[val]) || 0) / sum * 100; return `<tr><td>${esc(x[label])}</td><td class="pc"><em style="width:${Math.min(100, p).toFixed(1)}%"></em><span>${p.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} %</span></td><td class="num">${fmt(x[val])}</td></tr>`; });
}
function needExtra() { return '<div class="alert"><span>ℹ️</span><div>Bu rapor için restoran bilgisayarındaki Patron programının <b>C# sürüme</b> güncellenmesi gerekiyor (ornek-alanadi.com/downloads/PatronRaporuCSharpSetup.exe).</div></div>'; }
async function runReport() {
  if (!curRep) return;
  const seq = ++raporSeq, rep = curRep, r = rangeFor(rangeKey), box = $('raporBox');
  box.innerHTML = rhead(r) + '<p class="empty">Restoran bilgisayarından isteniyor…</p>';
  try {
    if (rep.id === 'gunsonu') {
      const { days, totals } = await api(`/api/customer/patron-report?start=${r.start}&end=${r.end}`);
      if (seq !== raporSeq) return;
      box.innerHTML = rhead(r) + stb('Gün Bazında Ciro', ['Tarih', 'Adisyon', 'Ciro'], days.map(d => `<tr><td>${esc(trDate(d.report_date))}</td><td class="num">${num(d.tickets)}</td><td class="num">${money(d.sales)}</td></tr>`), ['Toplam', num(totals.tickets), money(totals.sales)]) +
        '<p class="note">Bulutta her gün kaydedilen özet — restoran bilgisayarı kapalıyken de görünür.</p>';
      lastReport = { r }; return;
    }
    if (rep.id === 'iptal') {
      const list = (last && last.data && Array.isArray(last.data.notifications) ? last.data.notifications : []).filter(n => (n.kind === 'iptal' || n.kind === 'iade') && String(n.date).slice(0, 10) >= r.start && String(n.date).slice(0, 10) <= r.end);
      box.innerHTML = rhead(r) + stb('İptal / İade Edilen Adisyonlar', ['Tarih', 'Tür / Fiş', 'Tutar'], list.map(n => `<tr><td>${esc(String(n.date).slice(0, 16))}</td><td>${n.kind === 'iptal' ? '❌ İptal' : '↩ İade'} · ${esc(n.ticket)}<br><small>${esc(String(n.detail || '').slice(0, 80))}</small></td><td class="num">${money(Math.abs(n.amount))}</td></tr>`),
        list.length ? ['Toplam', `${list.length} kayıt`, money(list.reduce((a, n) => a + Math.abs(Number(n.amount) || 0), 0))] : null) + '<p class="note">Son 100 hareket içinden gösterilir.</p>';
      lastReport = { r }; return;
    }
    const data = await fetchReport(r.start, r.end, r.hs, r.he);
    let pdata = null;
    if (rep.id === 'karsi') { const p = prevRange(r); try { pdata = await fetchReport(p.start, p.end, r.hs, r.he); } catch { /* onceki donem olmadan da gosterilir */ } }
    if (seq !== raporSeq) return;
    lastReport = { r, data, pdata };
    box.innerHTML = rhead(r) + renderRep(rep, r, data, pdata);
  } catch (err) {
    if (seq !== raporSeq) return;
    box.innerHTML = rhead(r) + `<div class="alert"><span>⚠️</span><div>${esc(err.message)}</div></div>`;
  }
}
function renderRep(rep, r, data, pdata) {
  const s = data.summary || {}, x = data.extra;
  if (rep.extra && !x) return needExtra();
  switch (rep.id) {
    case 'kasa': {
      const pay = data.payments || [];
      return `<div class="kpis"><div class="k"><div class="n">${money(s.sales)}</div><div class="l">Ciro</div></div><div class="k"><div class="n">${num(s.tickets)}</div><div class="l">Adisyon</div></div>
        <div class="k"><div class="n">${money(s.average)}</div><div class="l">Ortalama fiş</div></div><div class="k"><div class="n">${money(s.remaining)}</div><div class="l">Açık bakiye</div></div></div>` +
        stb('Tahsilat Tipine Göre', ['Ödeme', '%', 'Tutar'], pctRows(pay, 'name', 'amount', money), ['Toplam Tahsilat', '', money(pay.reduce((a, p) => a + (Number(p.amount) || 0), 0))]) +
        stb('Departman Bazında', ['Departman', '%', 'Tutar'], pctRows(data.departments || [], 'name', 'amount', money));
    }
    case 'karsi': {
      const ps = pdata && pdata.summary, dc = (a, b) => { if (!ps) return ''; const d = delta(a, b); return `<div class="d ${d.cls === 'flat' ? 'mut' : d.cls}">${d.arrow} ${d.txt} ${esc(r.prevLabel)}</div>`; };
      const prevProd = {}; (pdata && pdata.products || []).forEach(p => { prevProd[p.name] = Number(p.amount) || 0; });
      return `<div class="kpis"><div class="k"><div class="n">${money(s.sales)}</div><div class="l">Ciro</div>${dc(s.sales, ps && ps.sales)}</div><div class="k"><div class="n">${num(s.tickets)}</div><div class="l">Adisyon</div>${dc(s.tickets, ps && ps.tickets)}</div>
        <div class="k"><div class="n">${money(s.average)}</div><div class="l">Ortalama fiş</div>${dc(s.average, ps && ps.average)}</div><div class="k"><div class="n">${ps ? money(ps.sales) : '—'}</div><div class="l">${esc(r.prevLabel)} ciro</div></div></div>` +
        dailyChart(r, data) +
        stb('Ürün Hareketi', ['Ürün', 'Tutar', 'Değişim'], (data.products || []).map(p => { const d = pdata ? delta(p.amount, prevProd[p.name] || 0) : null; return `<tr><td>${esc(p.name)}</td><td class="num">${money(p.amount)}</td><td class="num"><b class="${d && d.cls !== 'flat' ? d.cls : ''}">${d ? d.arrow + ' ' + d.txt : ''}</b></td></tr>`; }));
    }
    case 'urun': {
      const groups = x ? x.groups : [], prods = x ? x.products : (data.products || []);
      return (x ? stb('Ürün Grubu Bazında Satış Tutarları', ['Grup', '%', 'Tutar'], pctRows(groups, 'name', 'amount', money), ['Toplam', '', money(groups.reduce((a, g) => a + (Number(g.amount) || 0), 0))]) +
        stb('Ürün Grubu Bazında Adetler', ['Grup', '%', 'Adet'], pctRows(groups, 'name', 'quantity', num), ['Toplam', '', num(groups.reduce((a, g) => a + (Number(g.quantity) || 0), 0))]) : '') +
        stb('Ürün - Adet - Tutar', ['Ürün', 'Adet', 'Tutar'], prods.map(p => `<tr><td>${esc(p.name)}${p.group ? `<br><small>${esc(p.group)}</small>` : ''}</td><td class="num">${num(p.quantity)}</td><td class="num">${money(p.amount)}</td></tr>`));
    }
    case 'saatlik': {
      const h = (data.hourly || []).map(v => ({ ...v, lbl: pad2(v.hour) + ':00' }));
      return `<div class="box">${bars(h.map(v => ({ ...v, lbl: pad2(v.hour) })), 'amount', it => it.lbl, true)}</div>` +
        stb('Saatlik Ciro Oranları', ['Saat', '%', 'Ciro'], pctRows(h, 'lbl', 'amount', money), ['Toplam', '', money(h.reduce((a, v) => a + (Number(v.amount) || 0), 0))]) +
        stb('Saatlik Adisyon Sayıları', ['Saat', '%', 'Adisyon'], pctRows(h, 'lbl', 'count', num));
    }
    case 'saaturun': {
      const by = {}; x.hourlyProducts.forEach(p => { (by[p.hour] = by[p.hour] || []).push(p); });
      return Object.keys(by).map(Number).sort((a, b) => a - b).map(hh => stb(`${pad2(hh)}:00 – ${pad2(hh)}:59`, ['Ürün', 'Adet', 'Tutar'], by[hh].slice(0, 15).map(p => `<tr><td>${esc(p.name)}</td><td class="num">${num(p.quantity)}</td><td class="num">${money(p.amount)}</td></tr>`),
        ['Toplam', num(by[hh].reduce((a, p) => a + (Number(p.quantity) || 0), 0)), money(by[hh].reduce((a, p) => a + (Number(p.amount) || 0), 0))])).join('') || stb('Saatlik Ürün Satış', null, []);
    }
    case 'personel': {
      const u = data.users || [];
      return stb('Personel Satış Oranları (ciro)', ['Personel', '%', 'Ciro'], pctRows(u, 'name', 'amount', money), ['Toplam', '', money(u.reduce((a, v) => a + (Number(v.amount) || 0), 0))]) +
        stb('Personel Adisyon Sayıları', ['Personel', 'Adisyon', 'Ortalama'], u.map(v => `<tr><td>${esc(v.name)}</td><td class="num">${num(v.count)}</td><td class="num">${money(v.count ? v.amount / v.count : 0)}</td></tr>`));
    }
    case 'tahsilat': {
      const by = {}; x.userPayments.forEach(p => { (by[p.user] = by[p.user] || []).push(p); });
      const totals = Object.keys(by).map(k => ({ name: k, amount: by[k].reduce((a, p) => a + (Number(p.amount) || 0), 0) }));
      return stb('Kullanıcı Bazında Toplam Tahsilat', ['Kullanıcı', '%', 'Tutar'], pctRows(totals, 'name', 'amount', money), ['Toplam', '', money(totals.reduce((a, t) => a + t.amount, 0))]) +
        Object.keys(by).map(k => stb(`Tahsilat Tipine Göre · ${k}`, ['Ödeme', '%', 'Tutar'], pctRows(by[k], 'type', 'amount', money), ['Toplam', '', money(by[k].reduce((a, p) => a + (Number(p.amount) || 0), 0))])).join('');
    }
    case 'departman': return stb('Departman Satışları', ['Departman', '%', 'Ciro'], pctRows(data.departments || [], 'name', 'amount', money), ['Toplam', '', money((data.departments || []).reduce((a, d) => a + (Number(d.amount) || 0), 0))]) +
      stb('Departman Adisyon Sayıları', ['Departman', '%', 'Adisyon'], pctRows(data.departments || [], 'name', 'count', num));
    case 'iskonto': {
      const by = {}; x.calculations.forEach(c => { const b = by[c.name] || (by[c.name] = { name: c.name, amount: 0, count: 0 }); b.amount += Math.abs(Number(c.amount) || 0); b.count++; });
      const sums = Object.values(by);
      return stb('İskonto / Yuvarlama Türleri', ['Tür', 'Adet', 'Tutar'], sums.map(b => `<tr><td>${esc(b.name)}</td><td class="num">${b.count}</td><td class="num">${money(b.amount)}</td></tr>`), sums.length ? ['Toplam', sums.reduce((a, b) => a + b.count, 0), money(sums.reduce((a, b) => a + b.amount, 0))] : null) +
        stb('Adisyon Bazında', ['Tarih / Fiş', 'Tür · Kullanıcı', 'Tutar'], x.calculations.map(c => `<tr><td>${esc(c.date.slice(0, 16))}<br><small>Fiş ${esc(c.ticket)}</small></td><td>${esc(c.name)}<br><small>${esc(c.user)}</small></td><td class="num">${money(c.amount)}</td></tr>`));
    }
    case 'ikram': {
      const lbl = { ikram: '🧡 İkram', iade: '↩ İade', zayi: '🗑 Zayi' }, sums = {};
      x.specials.forEach(o => { const b = sums[o.kind] || (sums[o.kind] = { name: lbl[o.kind], q: 0, amount: 0 }); b.q += Number(o.quantity) || 0; b.amount += Number(o.amount) || 0; });
      return stb('Özet', ['Tür', 'Adet', 'Tutar'], Object.values(sums).map(b => `<tr><td>${b.name}</td><td class="num">${num(b.q)}</td><td class="num">${money(b.amount)}</td></tr>`)) +
        stb('İkram - İade - Zayi Ekstresi', ['Tarih / Fiş', 'Ürün · Kullanıcı', 'Tutar'], x.specials.map(o => `<tr><td>${esc(o.date.slice(0, 16))}<br><small>${lbl[o.kind]} · Fiş ${esc(o.ticket)}</small></td><td>${num(o.quantity)} × ${esc(o.name)}<br><small>${esc(o.user)}</small></td><td class="num">${money(o.amount)}</td></tr>`));
    }
    case 'paketci': return stb('Paketçi Bazında Teslimat', ['Paketçi', 'Paket', 'Tutar'], x.couriers.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${num(c.count)}</td><td class="num">${money(c.amount)}</td></tr>`),
      x.couriers.length ? ['Toplam', num(x.couriers.reduce((a, c) => a + (Number(c.count) || 0), 0)), money(x.couriers.reduce((a, c) => a + (Number(c.amount) || 0), 0))] : null);
    case 'adisyon': return stb('Adisyonlar (son 100)', ['Tarih / Fiş', 'Masa · Personel', 'Tutar'], (data.tickets || []).map(t => `<tr><td>${esc(t.date.slice(5, 16))}<br><small>Fiş ${esc(t.number)}</small></td><td>${esc(t.table)}<br><small>${esc(t.user)} · ${esc(t.department)}</small></td><td class="num">${money(t.amount)}</td></tr>`));
  }
  return '';
}
function dailyChart(r, data) {
  if (r.start === r.end) return `<div class="box"><h2>Saatlik satış</h2>${bars((data.hourly || []).map(h => ({ ...h, lbl: pad2(h.hour) })), 'amount', it => it.lbl, true)}</div>`;
  const byDay = {}; (data.daily || []).forEach(dd => { byDay[dd.date] = dd; });
  const all = []; for (let d = r.start; d <= r.end; d = addDays(d, 1)) { const dd = byDay[d] || { date: d, amount: 0, count: 0 }; all.push({ ...dd, lbl: daysBetween(r.start, r.end) <= 8 ? GUN3[parseLocal(d).getDay()] : d.slice(8, 10) }); if (all.length > 400) break; }
  return `<div class="box"><h2>Günlük ciro</h2>${bars(all, 'amount', it => it.lbl, true)}</div>`;
}
function bars(items, key, labelFn, highlightMax) {
  if (!items.length) return '<p class="empty">Bu aralıkta kayıt yok.</p>';
  const max = Math.max(1, ...items.map(i => Number(i[key]) || 0)), W = 320, H = 110, n = items.length, gap = n > 20 ? 2 : 6, bw = (W - gap * (n + 1)) / n;
  const best = items.reduce((a, b) => ((Number(b[key]) || 0) > (Number(a[key]) || 0) ? b : a), items[0]);
  const every = Math.ceil(n / 8);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">${items.map((it, i) => {
    const v = Number(it[key]) || 0, h = Math.max(2, v / max * (H - 26)), x = gap + i * (bw + gap);
    return `<rect x="${x.toFixed(1)}" y="${(H - 16 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, bw / 3).toFixed(1)}" fill="${highlightMax && it === best ? 'var(--good)' : 'var(--s1)'}"><title>${esc(labelFn(it))}: ${money(v)}</title></rect>` +
      (i % every === 0 ? `<text x="${(x + bw / 2 - 9).toFixed(1)}" y="${H - 4}" font-size="9" fill="var(--muted)">${esc(labelFn(it))}</text>` : '');
  }).join('')}</svg>`;
}
/* Excel: sayfadaki TUM mavi baslikli tablolar (Turkce Excel: ; ayirici, virgullu ondalik, BOM) */
function exportCsv() {
  const box = $('raporBox'); if (!box || !curRep) return;
  const q = v => `"${String(v ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`;
  const L = [[q('Patron Raporu'), q((last && last.businessName) || ''), q(curRep.name), q(box.querySelector('.rhead') ? box.querySelector('.rhead').textContent : '')].join(';'), ''];
  box.querySelectorAll('.stb').forEach(t => {
    L.push(q(t.querySelector('.th').textContent));
    t.querySelectorAll('tr').forEach(tr => L.push([...tr.children].map(td => q(td.textContent.replace(/ ₺$/, '').replace(/ %$/, ''))).join(';')));
    L.push('');
  });
  const blob = new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `patron-${curRep.id}-${(lastReport && lastReport.r && lastReport.r.start) || ''}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
$('xCsv').addEventListener('click', exportCsv);
$('xPdf').addEventListener('click', () => window.print());

/* ------------------------------------------------------------------ MENU + TOPLU ZAM */
let menuLoaded = false, mGroup = null, mTimer = null, knownTags = new Set(['Standart']);
async function loadMenu() {
  menuLoaded = true;
  const q = $('mSearch').value.trim();
  const url = `/api/customer/patron-menu?q=${encodeURIComponent(q)}` + (mGroup !== null ? `&group=${encodeURIComponent(mGroup)}` : '');
  try {
    const r = await api(url);
    const groups = r.groups || [];
    $('mGroups').innerHTML = `<button data-g="" class="${mGroup === null ? 'on' : ''}">Tümü</button>` + groups.map(g => `<button data-g="${esc(g.name)}" class="${mGroup === g.name ? 'on' : ''}">${esc(g.name)} <span class="mut">${g.count}</span></button>`).join('');
    const sel = $('bGroup'), cur = sel.value;
    sel.innerHTML = groups.map(g => `<option value="${esc(g.name)}">${esc(g.name)} (${g.count} ürün)</option>`).join('') + '<option value="*">Tüm menü</option>';
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur; else if (mGroup) sel.value = mGroup;
    (r.items || []).forEach(i => { if (i.tag_label) knownTags.add(i.tag_label); });
    const tsel = $('bTag'), tcur = tsel.value;
    tsel.innerHTML = '<option value="">Hepsi</option>' + [...knownTags].map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join(''); tsel.value = tcur;
    const items = r.items || [];
    $('mList').innerHTML = (!groups.length ? '<p class="note" style="margin-bottom:8px">Kategori bilgisi gelmedi — restoran bilgisayarındaki Patron\'u C# sürüme güncelleyin. Arama ve toplu zam (tüm menü) yine çalışır.</p>' : '') +
      (items.length ? items.map(i => `<div class="pr" data-pid="${i.price_id}"><div>${esc(i.item_name)}<div class="m mut" style="font-size:11.5px">${[i.portion_name && i.portion_name !== 'Normal' ? i.portion_name : '', i.tag_label || ''].filter(Boolean).map(esc).join(' · ')}</div></div>
        <span class="p" data-price>${money(i.price)}</span><button class="btng" data-edit>Değiştir</button></div>`).join('') + (mGroup === null && !q && r.itemCount > items.length ? `<p class="note">İlk ${items.length} ürün gösteriliyor (toplam ${r.itemCount}). Arayın ya da kategori seçin.</p>` : '')
        : '<p class="empty">Ürün bulunamadı.</p>');
  } catch (err) { $('mList').innerHTML = `<p class="err2">${esc(err.message)}</p>`; }
}
$('mSearch').addEventListener('input', () => { clearTimeout(mTimer); mTimer = setTimeout(loadMenu, 300); });
$('mGroups').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (!b) return; mGroup = b.dataset.g === '' ? null : b.dataset.g; loadMenu(); });
$('mList').addEventListener('click', async e => {
  const row = e.target.closest('.pr'); if (!row) return;
  if (e.target.closest('[data-edit]')) {
    if (row.querySelector('.edit')) { row.querySelector('.edit').remove(); return; }
    const ed = document.createElement('div'); ed.className = 'edit';
    ed.innerHTML = '<input type="text" inputmode="decimal" placeholder="Yeni fiyat"><button class="btnp" data-send style="padding:8px 12px">Gönder</button><span></span>';
    row.appendChild(ed); ed.querySelector('input').focus();
    return;
  }
  const send = e.target.closest('[data-send]'); if (!send) return;
  const ed = row.querySelector('.edit'), input = ed.querySelector('input'), msg = ed.querySelector('span');
  const val = input.value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(val)) { msg.className = 'err2'; msg.textContent = 'Geçerli bir fiyat yazın (ör. 125 ya da 12,50).'; return; }
  send.disabled = true; msg.className = 'mut'; msg.textContent = 'gönderiliyor…';
  try {
    const r = await queueAction('/api/customer/patron-price', { priceId: Number(row.dataset.pid), price: val });
    msg.textContent = r.connected ? 'restoran bilgisayarına gönderildi…' : 'sırada (restoran bilgisayarı bağlı değil)…';
    const st = await pollAction(r.id, { tries: 30, every: 2000 });
    row.querySelector('[data-price]').textContent = money(st.newPrice);
    msg.className = 'ok'; msg.textContent = `✓ uygulandı (${money(st.oldPrice)} → ${money(st.newPrice)})`;
  } catch (err) { msg.className = 'err2'; msg.textContent = err.message; send.disabled = false; }
});
function bulkBody(confirm) { return { group: $('bGroup').value, percent: Number(String($('bPct').value).replace(',', '.')), round: Number($('bRound').value), tag: $('bTag').value, confirm }; }
$('bPreview').addEventListener('click', async () => {
  const out = $('bResult'), b = bulkBody(false);
  if (!b.group) { out.innerHTML = '<p class="err2">Kategori seçin.</p>'; return; }
  if (!b.percent) { out.innerHTML = '<p class="err2">Yüzde yazın (ör. 10 ya da -5).</p>'; return; }
  out.innerHTML = '<p class="empty">Hesaplanıyor…</p>';
  try {
    const r = await api('/api/customer/patron-bulk-price', { method: 'POST', body: JSON.stringify(b) });
    if (!r.changes.length) { out.innerHTML = `<p class="empty">Değişecek fiyat yok (${r.matched} kayıt incelendi — yuvarlama sonrası aynı kalıyor olabilir).</p>`; return; }
    const sumOld = r.changes.reduce((a, c) => a + c.oldPrice, 0), sumNew = r.changes.reduce((a, c) => a + c.newPrice, 0);
    out.innerHTML = `<div class="prev">${r.changes.map(c => `<div class="li"><div>${esc(c.name)}<div class="m">${[c.portion && c.portion !== 'Normal' ? c.portion : '', c.tag].filter(Boolean).map(esc).join(' · ')}</div></div><b class="r">${money(c.oldPrice)} → <span class="${c.newPrice > c.oldPrice ? 'up' : 'down'}">${money(c.newPrice)}</span></b></div>`).join('')}</div>
      <p class="note">${r.changes.length} fiyat değişecek · ortalama değişim %${((sumNew - sumOld) / sumOld * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}. Onaylayınca restoran bilgisayarına gönderilir; kapalıysa açılınca uygulanır.</p>
      <div style="margin-top:10px" class="row2"><button class="btnp" id="bApply">Onayla ve uygula (${r.changes.length})</button><button class="btng" id="bCancel">Vazgeç</button></div>`;
    $('bCancel').onclick = () => { out.innerHTML = ''; };
    $('bApply').onclick = async () => {
      $('bApply').disabled = true;
      try {
        const a = await api('/api/customer/patron-bulk-price', { method: 'POST', body: JSON.stringify(bulkBody(true)) });
        out.innerHTML = `<p class="mut" id="bProg">${a.connected ? 'Restoran bilgisayarına gönderildi, uygulanıyor…' : 'Sıraya alındı — restoran bilgisayarı bağlanınca uygulanacak.'}</p>`;
        let tries = 0;
        const tick = async () => {
          tries++;
          try {
            const st = await api(`/api/customer/patron-bulk-status?ids=${a.ids.join(',')}`);
            const p = $('bProg'); if (!p) return;
            p.textContent = `${st.done} / ${st.total} uygulandı${st.failed ? ` · ${st.failed} hata (${st.errors.join(', ')})` : ''}`;
            if (st.done >= st.total) { p.className = st.failed ? 'err2' : 'ok'; p.textContent = (st.failed ? '⚠ ' : '✓ ') + p.textContent; setTimeout(loadMenu, 16000); return; }
          } catch { /* tekrar dene */ }
          if (tries < 90) setTimeout(tick, 2000);
        };
        setTimeout(tick, 1500);
      } catch (err) { out.innerHTML = `<p class="err2">${esc(err.message)}</p>`; }
    };
  } catch (err) { out.innerHTML = `<p class="err2">${esc(err.message)}</p>`; }
});

/* ------------------------------------------------------------------ BILDIRIM (iptal / iade / gun basi-sonu) */
function renderNotifications() {
  const box = $('ntfBox'); if (!box) return;
  const list = last && last.data && Array.isArray(last.data.notifications) ? last.data.notifications : [];
  const ic = { iptal: '❌ İptal', iade: '↩ İade', 'gun-basi': '🌓 Gün başı', 'gun-sonu': '🌕 Gün sonu' };
  box.innerHTML = list.length ? list.slice(0, 60).map(n => `<div class="ntf"><div class="h">${ic[n.kind] || esc(n.kind)}${n.kind === 'iptal' || n.kind === 'iade' ? ` · Fiş ${esc(n.ticket)}` : ` · ${esc(n.ticket)}`}<span>${esc(String(n.date).slice(5, 16).replace('-', '.'))}</span></div>` +
    `${n.kind === 'iptal' || n.kind === 'iade' ? money(Math.abs(n.amount)) + ' — ' : ''}${esc(String(n.detail || '').slice(0, 120))}</div>`).join('') : '<p class="empty">Henüz bildirim yok.</p>';
}
/* acilista oturum kontrolu - cerez gecerliyse dogrudan panele */
api('/api/customer/summary').then(enterApp).catch(() => {});
