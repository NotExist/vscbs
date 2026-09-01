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
const shape = () => ({ setStyle() {}, on() {}, bindTooltip() {}, bringToFront() {}, getBounds: bounds });
window.L = {
  map: () => ({ setView() { return this; }, flyToBounds() {}, fitBounds() {}, invalidateSize() {} }),
  tileLayer: () => ({ addTo() { return this; } }),
  layerGroup: () => ({ addTo() { return this; }, clearLayers() {}, addLayer() {} }),
  circle: shape, polygon: shape, circleMarker: () => ({ ...shape(), getLatLng: () => [0, 0] }),
  latLngBounds: bounds,
};

// --- 用檔案系統當 fetch ---
window.fetch = async (url) => {
  const file = path.join(ROOT, String(url).replace(/^https?:\/\/localhost\//, '').split('?')[0]);
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
check($('#mirror-time').textContent.includes('鏡像於'), `鏡像時間「${$('#mirror-time').textContent}」`);
check($('#month-select').options.length > 100, `月份選單 ${$('#month-select').options.length} 個月`);

console.log('\n[選取一筆]');
const before = cards.length;
cards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
check($$('.card.is-on').length === 1, '恰好一張卡片被選取');
check($('.card.is-on .detail') !== null, '選取後展開詳情');
check(window.location.hash.includes('id='), `網址帶上 id:${window.location.hash.slice(0, 60)}`);

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

console.log('\n[全覽]');
$('#fit-all').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
check(true, '全覽按鈕未拋錯');

check(errors.length === 0, `全程無執行期錯誤 ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);

console.log(`\n${fail.length ? `❌ ${fail.length} 項失敗` : '✅ 全數通過'}`);
process.exit(fail.length ? 1 : 0);
