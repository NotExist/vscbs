// 在 jsdom 裡把整個頁面跑起來,用真實鏡像資料驗證載入、篩選、選取都不會炸。
// Leaflet 需要真實版面才能運作,這裡用最小替身取代,只驗證應用層邏輯。
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const fail = [];
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}`); if (!ok) fail.push(msg); };

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
});
const { window } = dom;

// --- Leaflet 替身 ---
const bounds = () => ({
  isValid: () => true,
  extend() { return this; },
  getSouthWest: () => [21.9, 120.0],
  getNorthEast: () => [25.3, 122.0],
});
// 記下 click 處理器與 tooltip 文字,用來模擬點擊地圖圖層
const shape = () => ({ setStyle(st) { this.style = st; }, bringToFront() {}, getBounds: bounds,
  on(type, fn) { if (type === 'click') this.click = fn; },
  bindTooltip(text) { this.tooltip = text; } });
let flies = 0;
let mapClick = null;
// 圖層群組記下自己有哪些圖層、是否在地圖上,用來驗證「聚焦時只留該筆」
const onMap = new Set();
const groups = [];
const group = () => {
  const g = { layers: new Set(),
    addTo() { onMap.add(this); return this; },
    clearLayers() { this.layers.clear(); }, addLayer(l) { this.layers.add(l); } };
  groups.push(g);
  return g;
};
const visibleLayers = () => [...onMap].reduce((n, g) => n + g.layers.size, 0);
// 加粗標示(activeStyle weight 3)中的圖層數
const boldLayers = () => [...onMap].flatMap((g) => [...g.layers]).filter((l) => l.style?.weight === 3).length;
window.L = {
  map: () => ({ setView() { return this; }, flyToBounds() { flies++; }, fitBounds() {}, invalidateSize() {},
    on(type, fn) { if (type === 'click') mapClick = fn; },
    addLayer(g) { onMap.add(g); }, removeLayer(g) { onMap.delete(g); }, hasLayer: (g) => onMap.has(g) }),
  tileLayer: () => ({ addTo() { return this; } }),
  layerGroup: group,
  circle: shape, polygon: shape, circleMarker: () => ({ ...shape(), getLatLng: () => [0, 0] }),
  latLngBounds: bounds,
  DomEvent: { stopPropagation() {} },
};

// --- 用檔案系統當 fetch ---
// 最新告警改讀固定快照:即時 feed 隨災防需求變動,沒有告警時是空的,不能拿來跑互動檢查。
// 即時 feed 本身另在最後以「能解析、筆數不拘」檢查。
const FIXTURE_FEED = path.join(ROOT, 'tests/fixtures/rssatomfeed.xml');
const fetched = [];
window.fetch = async (url) => {
  fetched.push(String(url));
  const rel = String(url).replace(/^https?:\/\/localhost\//, '').split('?')[0];
  const file = rel === 'data/rssatomfeed.xml' ? FIXTURE_FEED : path.join(ROOT, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '' };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, 'utf8') };
};
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.scrollIntoView = () => {};
window.Element.prototype.scrollIntoView = () => {};

for (const k of ['DOMParser', 'Intl', 'IntersectionObserver', 'fetch', 'L']) globalThis[k] = window[k];
globalThis.document = window.document;
globalThis.window = window;
globalThis.location = window.location;
globalThis.history = window.history;
// setTimeout 沿用 node 原生的:改綁 jsdom 的版本會與 jsdom 內部互相遞迴

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
process.on('unhandledRejection', (e) => errors.push(String(e)));

await import(path.join(ROOT, 'assets/app.js'));
await new Promise((r) => setTimeout(r, 800)); // 等 boot() 的非同步載入

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];

console.log('\n[最新告警]');
check(errors.length === 0, `無執行期錯誤 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
const cards = $$('.card');
check(cards.length > 0, `清單渲染出 ${cards.length} 張卡片`);
check($$('.chip').length > 0, `事件類型 chips ${$$('.chip').length} 個`);
check(/\d+ \/ \d+ 筆/.test($('#summary').textContent), `摘要文字「${$('#summary').textContent}」`);
check($('#legend').children.length > 0, `圖例 ${$('#legend').children.length} 項`);
check($('#mirror-time').textContent.includes('資料更新於'), `資料更新時間「${$('#mirror-time').textContent}」`);
{
  const admins = fetched.filter((u) => /admin\/\d{5}\.json/.test(u));
  check(admins.length > 0 && admins.length < 22, `只載入用得到的縣市行政區檔(${admins.length} 個)`);
}
check([...$('#month-select').options].some((o) => /（[\d,]+ 筆）$/.test(o.textContent)),
  `月份選單附筆數:「${$('#month-select').options[0]?.textContent}」`);
check($('#month-select').options.length > 100, `月份選單 ${$('#month-select').options.length} 個月`);

console.log('\n[選取一筆]');
const before = cards.length;
cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
check($$('.card.is-on').length === 1, '恰好一張卡片被選取');
check($('.card.is-on .detail') !== null, '選取後展開詳情');
{
  const dts = $$('.card.is-on .detail dt').map((d) => d.textContent);
  const prose = $('.card.is-on .detail .prose');
  check(dts.includes('告警說明') || dts.includes('應變建議'), `詳情帶官方說明(欄位:${dts.join('、')})`);
  check(prose && !/[<>]|xss=/.test(prose.textContent), '官方說明已轉成純文字,無 HTML 殘留');
}
check(window.location.hash.includes('id='), `網址帶上 id:${window.location.hash.slice(0, 60)}`);

console.log('\n[地圖聚焦]');
// 先收合選取,確認顯示全部
$('.card.is-on').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
const allCount = visibleLayers();
check(allCount > 10, `未聚焦時地圖顯示全部 ${allCount} 個圖層`);
const hoverCard = $$('.card')[2];
hoverCard.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
const hoverCount = boldLayers();
check(visibleLayers() === allCount && hoverCount > 0, `滑過一筆時全部 ${allCount} 個圖層照常顯示,該筆 ${hoverCount} 個加粗`);
$('#list').dispatchEvent(new window.MouseEvent('mouseleave'));
check(visibleLayers() === allCount && boldLayers() === 0, '滑出清單後取消加粗');
hoverCard.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
hoverCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
const selCount = visibleLayers();
check(selCount === hoverCount && boldLayers() === selCount, '從清單點選(滑鼠仍在該卡上)地圖只留該筆並加粗');
$('#list').dispatchEvent(new window.MouseEvent('mouseleave'));
check(visibleLayers() === selCount, '滑出清單後仍只留選取那筆');
$$('.card')[3].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
check(visibleLayers() === allCount && boldLayers() > selCount, '選取中滑過另一筆:暫時全部顯示,兩筆都加粗');
$('#list').dispatchEvent(new window.MouseEvent('mouseleave'));
check(visibleLayers() === selCount, '滑出後回到只留選取那筆');
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
await new Promise((r) => setTimeout(r, 50));
check(visibleLayers() === allCount && !$('.card.is-on'), 'Esc 取消選取並恢復全部');

console.log('\n[點地圖圖層]');
const shown = [...onMap].flatMap((g) => [...g.layers]);
const layerHit = shown.find((l) => l.click);
check(/^\d{2}\/\d{2}\D+\d{2}:\d{2}　/.test(layerHit.tooltip || ''), `tooltip 以時間開頭:「${(layerHit.tooltip || '').slice(0, 40)}」`);
const fliesBefore = flies;
layerHit.click({});
await new Promise((r) => setTimeout(r, 50));
check($$('.card.is-on').length === 1, '點地圖圖層選取並展開對應卡片');
check(flies === fliesBefore, '點地圖選取時地圖不飛移縮放');
check(visibleLayers() === allCount, '點地圖選取時其他告警仍全部顯示');
mapClick?.();
await new Promise((r) => setTimeout(r, 50));
check(!$('.card.is-on') && visibleLayers() === allCount, '點地圖空白處取消選取');
$$('.card')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
check(flies === fliesBefore + 1 && visibleLayers() < allCount, '點清單仍飛移並只留該筆');
mapClick?.();
await new Promise((r) => setTimeout(r, 50));

console.log('\n[事件類型篩選]');
const chip = $('.chip');
const code = chip.dataset.event;
chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
const after = $$('.card').length;
check(after > 0 && after <= before, `篩選 ${code} 後 ${after} 筆(原 ${before} 筆)`);
check(window.location.hash.includes(`e=${code}`), '網址帶上篩選條件');

console.log('\n[清除篩選]');
$('#reset').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
check($$('.card').length === before, `回到 ${$$('.card').length} 筆`);

console.log('\n[切換到歷史回顧]');
$('#tab-archive').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 1500));
// 選單第一個可能是累積中的當月(筆數不定),互動檢查固定用已封存、內容不再變動的 2026-09
$('#month-select').value = '202609';
$('#month-select').dispatchEvent(new window.Event('change'));
await new Promise((r) => setTimeout(r, 1500));
check($('#month-select').value === '202609', '固定使用已封存的 2026-09 做互動檢查');
check($$('.card').length > 0, `歷史月份載入 ${$$('.card').length} 張卡片(分頁上限 120)`);
check(!$('.month-pick').hidden, '月份選單顯示');
check(!$('#daybar-wrap').hidden && $$('.day').length > 1, `日期條 ${$$('.day').length} 天`);
const approxTags = $$('.tag.warn').length;
check(true, `其中標為概略位置的卡片標籤 ${approxTags} 個`);

console.log('\n[點某一天]');
const day = $$('.day')[Math.floor($$('.day').length / 2)];
const dayKey = day.dataset.day;
day.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
check($$('.card').length > 0, `${dayKey} 有 ${$$('.card').length} 筆`);
check($('.day.is-on')?.dataset.day === dayKey, '該日按鈕呈現選取狀態');

console.log('\n[搜尋]');
$('#day-all').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
const monthTotal = $$('.card').length;
$('#search').value = '水庫';
$('#search').dispatchEvent(new window.Event('input'));
await new Promise((r) => setTimeout(r, 400));
const found = $$('.card').length;
check(found > 0 && found <= monthTotal, `整月搜尋「水庫」→ ${found} 筆`);
check($$('.card').every((c) => /水庫/.test(c.textContent)), '每張卡片都命中關鍵字');

console.log('\n[從網址還原狀態]');
const target = $$('.card')[1];
target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 80));
const restored = window.location.hash;
check(/m=\d{6}/.test(restored) && /q=/.test(restored) && /id=/.test(restored),
  `網址完整記錄月份/關鍵字/選取:${decodeURIComponent(restored).slice(0, 70)}`);
window.location.hash = restored;
window.dispatchEvent(new window.Event('hashchange'));
await new Promise((r) => setTimeout(r, 1200));
check($$('.card.is-on').length === 1, '重新套用網址後仍選取同一筆');
check($('#search').value === '水庫', '搜尋框還原');
check($('#month-select').value === restored.match(/m=(\d{6})/)[1], '月份還原');

console.log('\n[鍵盤操作]');
$('#reset').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
const kbCard = $$('.card')[3];
check(kbCard.getAttribute('role') === 'button' && kbCard.tabIndex === 0, '卡片可用鍵盤聚焦');
kbCard.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
check($('.card.is-on')?.dataset.id === kbCard.dataset.id, 'Enter 鍵可選取卡片');
check($('.card.is-on').getAttribute('aria-expanded') === 'true', 'aria-expanded 反映展開狀態');

console.log('\n[多區域告警的發布區域清單]');
window.location.hash = '#m=201804&id=A20180418142332513'; // 臺南 CBS 測試,30 個村里
window.dispatchEvent(new window.Event('hashchange'));
await new Promise((r) => setTimeout(r, 1200));
{
  const d = $('.card.is-on .detail');
  const shownAreas = d ? d.querySelectorAll(':scope dd > .areas > li').length : 0;
  const more = d?.querySelector('.area-more summary');
  check(shownAreas === 10, `先列出 10 個區域(實際 ${shownAreas})`);
  check(more?.textContent === '其餘 20 個', `其餘折疊:「${more?.textContent}」`);
  check(d && !/\u3000/.test(d.textContent), '區域名稱的全形空格已整理');
  check(/村里界/.test(d?.textContent) && /範圍說明/.test(d?.textContent), '行政區代碼畫出內政部村里界並說明');
  check(/鄉鎮落點/.test(d?.textContent), '已整併的舊里代碼退回地名查表的概略落點');
  more?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  check($$('.card.is-on').length === 1, '點「其餘 N 個」不會收合卡片');
}

console.log('\n[即時 feed 累積的當月]');
{
  const partial = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mirror.json'), 'utf8')).months.find((m) => m.partial);
  if (!partial) {
    check(true, '目前沒有累積中的月份,略過');
  } else {
    const opt = [...$('#month-select').options].find((o) => o.value === partial.id);
    check(/累積中/.test(opt?.textContent), `選單標示累積中:「${opt?.textContent}」`);
    window.location.hash = `#m=${partial.id}`;
    window.dispatchEvent(new window.Event('hashchange'));
    await new Promise((r) => setTimeout(r, 800));
    check(fetched.some((u) => u.includes(`current/atom-${partial.id}.xml`)), '從 current/ 載入累積檔');
    check($$('.card').length === Math.min(partial.entries, 120), `累積月份渲染 ${$$('.card').length} 張卡片(累積 ${partial.entries} 筆)`);
  }
}

console.log('\n[即時資料]');
{
  // 即時 feed 沒有任何告警(0 筆)是正常狀態,只要求能解析、不拋錯
  const { parseFeed } = await import(path.join(ROOT, 'assets/parse.js'));
  let live = null;
  try { live = parseFeed(fs.readFileSync(path.join(ROOT, 'data/rssatomfeed.xml'), 'utf8')); } catch (e) { errors.push(String(e)); }
  check(Array.isArray(live), `即時 feed 可解析(${live?.length ?? '失敗'} 筆,0 筆也屬正常)`);
  const empty = parseFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>');
  check(Array.isArray(empty) && empty.length === 0, '空 feed 解析為 0 筆、不拋錯');
}

console.log('\n[全覽]');
$('#fit-all').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
check(true, '全覽按鈕未拋錯');

check(errors.length === 0, `全程無執行期錯誤 ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);

console.log(`\n${fail.length ? `❌ ${fail.length} 項失敗` : '✅ 全數通過'}`);
process.exit(fail.length ? 1 : 0);
