import { parseFeed, parseIndex, setPlaces, addAdmin } from './parse.js';
import { eventInfo, channelLabel, setAlertTypes, countyCodeOf } from './catalog.js';
import { createMap } from './map.js';

const DATA = 'data/';
const PAGE = 120;
const TZ = 'Asia/Taipei'; // 告警是台灣發布的,一律以台北時間呈現

// 只有行政區代碼的告警,其落點精度取決於地名能對到哪一層
const LEVEL = { village: '村里概略位置', town: '鄉鎮概略位置', county: '縣市概略位置' };

const $ = (sel) => document.querySelector(sel);
const el = {
  list: $('#list'), chips: $('#event-chips'), search: $('#search'), reset: $('#reset'),
  summary: $('#summary'), daybar: $('#daybar'), daybarWrap: $('#daybar-wrap'), dayAll: $('#day-all'),
  monthPick: $('.month-pick'), monthSelect: $('#month-select'), mirrorTime: $('#mirror-time'),
  legend: $('#legend'), status: $('#status'), fitAll: $('#fit-all'),
};

const state = {
  mode: 'latest',
  month: null,
  entries: [],
  view: [],
  events: new Set(),
  day: null,
  q: '',
  selected: null,
  selectedFromMap: false, // 從地圖點選時不聚焦也不飛移,其他告警照常顯示
  shown: 0, // 清單已渲染的筆數;捲到底或選到更後面的告警時才往後補
  sameDay: false,
};

const cache = new Map();
let map;

/* ---------- 格式化 ---------- */
const fmt = (opts) => new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, ...opts });
const fDateTime = fmt({ month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const fTime = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const fFull = fmt({ dateStyle: 'medium', timeStyle: 'short', hour12: false });
const fParts = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

// 以台北時區取 YYYY-MM-DD,避免瀏覽器在別的時區時分組錯日
function dayKey(date) {
  if (!date) return '';
  const p = Object.fromEntries(fParts.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function toast(msg, ms = 2200) {
  el.status.textContent = msg;
  el.status.classList.add('is-on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.status.classList.remove('is-on'), ms);
}

/* ---------- 載入 ---------- */
async function fetchText(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

// 行政區檔依縣市分檔,只載入這份資料用得到的縣市(每檔數十到數百 KB)
const adminLoaded = new Map(); // 縣市代碼 → Promise
function loadAdmin(xml) {
  const counties = new Set();
  for (const [, v] of xml.matchAll(/<geocode>[\s\S]*?<value>([^<]*)<\/value>/g)) {
    const c = countyCodeOf(v);
    if (c) counties.add(c);
  }
  return Promise.all([...counties].map((c) => {
    if (!adminLoaded.has(c)) {
      adminLoaded.set(c, fetchText(`${DATA}admin/${c}.json`)
        .then((t) => addAdmin(JSON.parse(t)))
        .catch(() => adminLoaded.delete(c))); // 失敗就退回地名表,下次再試
    }
    return adminLoaded.get(c);
  }));
}

async function loadFeed(key, path) {
  if (cache.has(key)) return cache.get(key);
  el.list.innerHTML = '<p class="empty">載入中…</p>';
  const xml = await fetchText(path);
  await loadAdmin(xml); // 必須在 parseFeed 之前:解析時就要依代碼決定落點
  const entries = parseFeed(xml);
  cache.set(key, entries);
  return entries;
}

async function boot() {
  map = createMap($('#map'), {
    onSelect: (id) => select(id, { fromMap: true }),
    formatTime: (d) => fDateTime.format(d),
  });

  // 地名座標表要在任何 parseFeed 之前就位,否則只有行政區代碼的告警會退成縣市中心
  try {
    setPlaces(JSON.parse(await fetchText(DATA + 'places.json')));
  } catch {
    // 沒有地名表也能運作,只是精度退到縣市層級
  }
  try {
    setAlertTypes(JSON.parse(await fetchText(DATA + 'alert-types.json')));
  } catch {
    // 沒有官方說明時事件名稱退回 catalog.js 的對照表,詳情不顯示說明與建議
  }

  let months = [];
  try {
    const mirror = JSON.parse(await fetchText(DATA + 'mirror.json'));
    months = mirror.months.map((m) => m.id);
    el.mirrorTime.textContent = `資料更新於 ${fFull.format(new Date(mirror.mirroredAt))}`;
    el.mirrorTime.title = '本站每小時檢查 cbs.tw；此為來源最後一次有變動的時間';
  } catch {
    // 沒有 manifest 就退回讀鏡像的 list.xml
    try {
      months = parseIndex(await fetchText(DATA + 'list.xml')).map((m) => m.id);
    } catch { /* 索引缺失時仍可只看最新告警 */ }
  }

  el.monthSelect.innerHTML = months
    .map((id) => `<option value="${id}">${id.slice(0, 4)} 年 ${Number(id.slice(4))} 月</option>`)
    .join('');

  bindUI();
  await applyHash();
  window.addEventListener('hashchange', applyHash);
}

/* ---------- 網址狀態 ---------- */
function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    month: p.get('m'),
    day: p.get('d'),
    events: (p.get('e') || '').split(',').filter(Boolean),
    q: p.get('q') || '',
    id: p.get('id') || '',
  };
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.mode === 'archive' && state.month) p.set('m', state.month);
  if (state.day) p.set('d', state.day);
  if (state.events.size) p.set('e', [...state.events].join(','));
  if (state.q) p.set('q', state.q);
  if (state.selected) p.set('id', state.selected);
  const next = '#' + p.toString();
  if (next !== location.hash) history.replaceState(null, '', next || location.pathname);
}

async function applyHash() {
  const h = readHash();
  const mode = h.month ? 'archive' : 'latest';
  const changedSource = mode !== state.mode || (mode === 'archive' && h.month !== state.month);

  state.mode = mode;
  state.month = h.month || state.month;
  state.events = new Set(h.events);
  state.day = h.day || null;
  state.q = h.q;
  el.search.value = h.q;

  if (changedSource || !state.entries.length) await loadCurrent();
  refresh();
  if (h.id) select(h.id, { silent: true });
}

async function loadCurrent() {
  try {
    if (state.mode === 'latest') {
      state.entries = await loadFeed('latest', DATA + 'rssatomfeed.xml');
    } else {
      const m = state.month || el.monthSelect.value;
      state.month = m;
      state.entries = await loadFeed(m, `${DATA}archive/atom-${m}.xml`);
    }
  } catch (err) {
    state.entries = [];
    el.list.innerHTML = `<p class="empty">載入失敗：${err.message}</p>`;
  }
  state.selected = null;
  syncModeUI();
}

function syncModeUI() {
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.classList.toggle('is-on', btn.dataset.mode === state.mode);
    btn.setAttribute('aria-selected', String(btn.dataset.mode === state.mode));
  }
  el.monthPick.hidden = state.mode !== 'archive';
  if (state.mode === 'archive' && state.month) el.monthSelect.value = state.month;
}

/* ---------- 篩選 ---------- */
function matches(e) {
  if (state.events.size && !state.events.has(e.event)) return false;
  if (state.day && dayKey(e.sentAt) !== state.day) return false;
  if (state.q && !haystack(e).includes(state.q.toLowerCase())) return false;
  return true;
}

const haystack = (e) =>
  `${e.title} ${e.sender} ${e.text} ${e.areas.map((a) => a.desc).join(' ')}`.toLowerCase();

function refresh() {
  state.view = state.entries.filter(matches);
  // 結果全在同一天(或篩到單日)時卡片省略日期,只留時分
  state.sameDay = !!state.day || new Set(state.view.map((e) => dayKey(e.sentAt))).size === 1;
  renderChips();
  renderDaybar();
  renderList();
  renderLegend();
  const drawn = map.render(state.view);
  hoveredId = null;
  if (state.selected && !state.view.some((e) => e.id === state.selected)) state.selected = null;
  map.select(state.selected, { fly: false });
  syncFocus();
  const noGeo = state.view.length - drawn;
  el.summary.textContent = state.entries.length
    ? `${state.view.length} / ${state.entries.length} 筆` + (noGeo ? `・${noGeo} 筆無地理範圍` : '')
    : '';
  writeHash();
}

/* ---------- 篩選列 ---------- */
function renderChips() {
  // 計數要套用日期與關鍵字,但不套用類型本身,否則選了一個類型後其他類型全變 0
  const counts = new Map();
  for (const e of state.entries) {
    if (state.day && dayKey(e.sentAt) !== state.day) continue;
    if (state.q && !haystack(e).includes(state.q.toLowerCase())) continue;
    counts.set(e.event, (counts.get(e.event) || 0) + 1);
  }
  const codes = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  el.chips.innerHTML = codes.map(([code, n]) => {
    const info = eventInfo(code);
    const on = state.events.has(code) ? ' is-on' : '';
    return `<button class="chip${on}" data-event="${code}" aria-pressed="${!!on}">
      <i style="background:${info.color}"></i>${info.label}<b>${n}</b></button>`;
  }).join('');
}

function renderDaybar() {
  const counts = new Map();
  for (const e of state.entries) {
    const k = dayKey(e.sentAt);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const days = [...counts.keys()].sort();
  el.daybarWrap.hidden = days.length < 2;
  if (el.daybarWrap.hidden) return;
  const max = Math.max(...counts.values());
  el.daybar.innerHTML = days.map((k) => {
    const n = counts.get(k);
    const h = Math.max(3, Math.round((n / max) * 26));
    const on = state.day === k ? ' is-on' : '';
    return `<button class="day${on}" data-day="${k}" title="${k}・${n} 筆">
      <u style="height:${h}px"></u><s>${Number(k.slice(8))}</s></button>`;
  }).join('');
  el.daybar.querySelector('.is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderLegend() {
  const seen = new Map();
  for (const e of state.view) if (!seen.has(e.event)) seen.set(e.event, eventInfo(e.event));
  el.legend.innerHTML = [...seen.values()]
    .map((i) => `<span><i style="background:${i.color}"></i>${i.label}</span>`).join('');
}

/* ---------- 清單 ---------- */
function areaSummary(e) {
  const n = { circle: 0, polygon: 0, geocode: 0 };
  for (const a of e.areas) n[a.kind] += 1;
  const bits = [];
  if (n.polygon) bits.push(`${n.polygon} 個多邊形`);
  if (n.circle) bits.push(`${n.circle} 個圓形`);
  if (n.geocode) bits.push(`${n.geocode} 個行政區`);
  return bits.join('・') || '未提供區域';
}

const AREA_PREVIEW = 10; // 區域超過這個數量時,其餘折疊
const LEVEL_SHORT = { village: '村里落點', town: '鄉鎮落點', county: '縣市落點' };
const LEVEL_AREA = { village: '村里', town: '鄉鎮市區', county: '縣市' };

function areaLine(a) {
  const name = (a.desc || '').replace(/[\s\u3000]+/g, ' ').trim() || '（未命名）';
  const kind = a.kind === 'polygon' ? '多邊形'
    : a.kind === 'circle' ? `圓形・半徑 ${Number((a.radiusKm || 0).toFixed(1))} km`
      : a.shape ? `${LEVEL_AREA[a.approx.level]}界`
        : a.approx ? `行政區・${LEVEL_SHORT[a.approx.level] || '概略落點'}` : '行政區・無座標';
  return `<li>${esc(name)} <span class="area-kind">${esc(kind)}</span></li>`;
}

function areaListHTML(e) {
  if (!e.areas.length) return '未提供區域';
  const head = e.areas.slice(0, AREA_PREVIEW).map(areaLine).join('');
  const rest = e.areas.slice(AREA_PREVIEW);
  const more = rest.length
    ? `<details class="area-more"><summary>其餘 ${rest.length} 個</summary><ul class="areas">${rest.map(areaLine).join('')}</ul></details>`
    : '';
  const count = e.areas.length > 1 ? areaSummary(e) : '';
  return `${count}<ul class="areas">${head}</ul>${more}`;
}

function cardHTML(e, sameDay) {
  const info = eventInfo(e.event);
  const on = state.selected === e.id;
  const time = e.sentAt ? (sameDay ? fTime : fDateTime).format(e.sentAt) : '';
  const tags = [`<span class="tag ev" style="background:${info.color}">${info.short}</span>`];
  if (e.channel && e.channel !== '911') tags.push(`<span class="tag">${channelLabel(e.channel)}</span>`);
  if (e.center?.approx) tags.push(`<span class="tag warn">${LEVEL[e.center.level] || '概略位置'}</span>`);
  if (!e.center) tags.push('<span class="tag warn">無座標</span>');

  // 用 div 而非 button:詳情裡有 <a>,巢狀互動元素不合法
  return `<div class="card${on ? ' is-on' : ''}" data-id="${e.id}" role="button" tabindex="0"
    aria-expanded="${on}" style="--dot:${info.color}">
    <div class="card-top">
      <span class="card-title">${esc(e.title)}</span>
      <span class="card-time">${time}</span>
    </div>
    <div class="card-sub">${esc(e.sender)}</div>
    <div class="card-text">${esc(e.text)}</div>
    <div class="tags">${tags.join('')}</div>
    ${on ? detailHTML(e) : ''}
  </div>`;
}

function detailHTML(e) {
  const rows = [
    ['發布時間', e.sentAt ? fFull.format(e.sentAt) : '—'],
    ['有效至', e.expires ? fFull.format(new Date(e.expires)) : '—'],
    ['事件類別', `${eventInfo(e.event).label}（${esc(e.event)}）`],
    ['發送頻道', channelLabel(e.channel)],
    ['發布區域', areaListHTML(e)],
  ];
  if (e.areas.some((a) => a.shape)) {
    rows.push(['範圍說明', '原始訊息只給行政區代碼，地圖畫的是該行政區的界線（內政部村里／鄉鎮市區界）。']);
  }
  if (e.center?.approx) {
    rows.push(['座標說明',
      `原始訊息未附經緯度，僅給行政區。地圖上以${LEVEL[e.center.level] || '概略位置'}的虛線圈標示，不是實際影響範圍。`]);
  }
  const official = eventInfo(e.event).official;
  if (official?.desc) rows.push(['告警說明', `<span class="prose">${esc(official.desc)}</span>`]);
  if (official?.recommend) rows.push(['應變建議', `<span class="prose">${esc(official.recommend)}</span>`]);
  const link = e.link
    ? `<dt>原始訊息</dt><dd><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.link)}</a></dd>`
    : '';
  return `<div class="detail"><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}${link}</dl></div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const moreHTML = () => {
  const rest = state.view.length - state.shown;
  return rest ? `<p class="more" id="more">再顯示 ${Math.min(rest, PAGE)} 筆（共 ${rest} 筆未顯示）</p>` : '';
};

function renderList() {
  state.shown = 0;
  if (!state.view.length) {
    el.list.innerHTML = '<p class="empty">沒有符合條件的告警</p>';
    return;
  }
  el.list.innerHTML = '';
  showUpTo(PAGE);
}

// 只往後補新的卡片,不重建已渲染的部分
function showUpTo(n) {
  const to = Math.min(n, state.view.length);
  if (to <= state.shown) return;
  $('#more')?.remove();
  const html = state.view.slice(state.shown, to).map((e) => cardHTML(e, state.sameDay)).join('');
  state.shown = to;
  el.list.insertAdjacentHTML('beforeend', html + moreHTML());
  const more = $('#more');
  if (more) moreObserver.observe(more);
}

// 只重畫一張卡(選取狀態變了),不動其他卡
function redrawCard(id) {
  const card = id && [...el.list.querySelectorAll('.card')].find((c) => c.dataset.id === id);
  const e = card && state.view.find((x) => x.id === id);
  if (e) card.outerHTML = cardHTML(e, state.sameDay);
}

const moreObserver = new IntersectionObserver((rows) => {
  for (const row of rows) {
    if (!row.isIntersecting) continue;
    moreObserver.unobserve(row.target);
    showUpTo(state.shown + PAGE);
  }
}, { root: el.list, rootMargin: '200px' });

/* ---------- 地圖聚焦 ---------- */
// 滑過的那筆優先,其次是選取的那筆;兩者皆無才顯示全部結果
let hoveredId = null;
// 滑過清單與從地圖點選:其他告警照常顯示,只加粗標示該筆。
// 只有從清單點選時才只留該筆(滑鼠仍停在那張卡片上也一樣);
// 選取後滑過別張卡片則暫時回到全部顯示,滑出後恢復。
function syncFocus() {
  const browsing = hoveredId && hoveredId !== state.selected;
  map.focus(browsing || state.selectedFromMap ? null : state.selected);
  map.hover(hoveredId);
}

/* ---------- 選取 ---------- */
function select(id, { fromMap = false, silent = false } = {}) {
  if (state.selected === id && !fromMap && !silent) id = null; // 再點一次收合
  const prev = state.selected;
  state.selected = id;

  if (id) {
    const idx = state.view.findIndex((e) => e.id === id);
    if (idx < 0) {
      if (!silent) toast('該筆不在目前的篩選結果中');
      state.selected = null;
    } else {
      showUpTo(Math.ceil((idx + 1) / PAGE) * PAGE); // 還沒渲染到就往後補到它所在的頁
    }
  }
  // 只重畫選取狀態有變的兩張卡
  redrawCard(prev);
  redrawCard(state.selected);
  state.selectedFromMap = !!state.selected && fromMap;
  map.select(state.selected, { fly: !!state.selected && !fromMap });
  syncFocus();
  if (state.selected) {
    const card = el.list.querySelector('.card.is-on');
    card?.scrollIntoView({ block: fromMap ? 'center' : 'nearest', behavior: 'smooth' });
    if (!map.has(state.selected)) toast('這筆告警沒有可繪製的地理範圍');
  }
  writeHash();
}

/* ---------- 事件 ---------- */
function bindUI() {
  document.querySelector('.mode').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.mode-btn');
    if (!btn || btn.dataset.mode === state.mode) return;
    state.mode = btn.dataset.mode;
    state.day = null;
    state.selected = null;
    if (state.mode === 'archive' && !state.month) state.month = el.monthSelect.value;
    await loadCurrent();
    refresh();
  });

  el.monthSelect.addEventListener('change', async () => {
    state.month = el.monthSelect.value;
    state.day = null;
    state.selected = null;
    await loadCurrent();
    refresh();
  });

  el.chips.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    const code = chip.dataset.event;
    state.events.has(code) ? state.events.delete(code) : state.events.add(code);
    refresh();
  });

  el.daybar.addEventListener('click', (ev) => {
    const day = ev.target.closest('.day');
    if (!day) return;
    state.day = state.day === day.dataset.day ? null : day.dataset.day;
    refresh();
  });

  el.dayAll.addEventListener('click', () => { state.day = null; refresh(); });

  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = el.search.value.trim(); refresh(); }, 200);
  });

  el.reset.addEventListener('click', () => {
    state.events.clear();
    state.day = null;
    state.q = '';
    el.search.value = '';
    refresh();
  });

  el.list.addEventListener('click', (ev) => {
    const card = ev.target.closest('.card');
    if (!card || ev.target.closest('a, summary')) return; // 連結與「其餘 N 個」不觸發選取
    select(card.dataset.id);
  });

  el.list.addEventListener('mouseover', (ev) => {
    const id = ev.target.closest('.card')?.dataset.id || null;
    if (id === hoveredId) return;
    hoveredId = id;
    syncFocus();
  });

  el.list.addEventListener('mouseleave', () => {
    hoveredId = null;
    syncFocus();
  });

  // 點地圖空白處或按 Esc 取消選取,回到顯示全部
  map.map.on('click', () => { if (state.selected) select(state.selected); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.selected) select(state.selected);
  });

  el.list.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = ev.target.closest('.card');
    if (!card || ev.target.closest('a, summary')) return; // 連結與「其餘 N 個」不觸發選取
    ev.preventDefault();
    select(card.dataset.id);
  });

  el.fitAll.addEventListener('click', () => map.fitAll());
}

boot().catch((err) => {
  el.list.innerHTML = `<p class="empty">初始化失敗：${esc(err.message)}</p>`;
});
