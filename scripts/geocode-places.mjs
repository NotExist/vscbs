#!/usr/bin/env node
// 把「只有行政區代碼」的告警其 areaDesc 地名,一次性查成座標存進 data/places.json。
// 前端因此不必在瀏覽器裡打地理編碼服務,查表即可得到村里/鄉鎮層級的落點。
// 遵守 Nominatim 使用政策:單執行緒、每秒至多一次、附可識別的 User-Agent。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'data/places.json');
const UA = 'vscbs-place-geocoder/1.0 (static CBS alert map; contact via repo issues)';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);

const { placeKey } = await import(path.join(ROOT, 'assets/catalog.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 掃出所有需要地名座標的鍵:該筆告警沒有 circle/polygon,只能靠 areaDesc 定位。
 * 這裡刻意用正則而非 DOM 解析,讓腳本不需要任何 npm 依賴。
 */
function collectKeys() {
  const files = [
    path.join(ROOT, 'data/rssatomfeed.xml'),
    ...fs.readdirSync(path.join(ROOT, 'data/archive'))
      .filter((f) => f.endsWith('.xml'))
      .map((f) => path.join(ROOT, 'data/archive', f)),
  ].filter((f) => fs.existsSync(f));

  const counts = new Map();
  for (const file of files) {
    const xml = fs.readFileSync(file, 'utf8');
    for (const [, body] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      if (/<(circle|polygon)>/.test(body)) continue; // 有精確幾何就不需要地名
      let desc = '';
      for (const m of body.matchAll(/<areaDesc>([\s\S]*?)<\/areaDesc>|<geocode>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/geocode>/g)) {
        if (m[1] !== undefined) { desc = m[1].trim(); continue; }
        const key = placeKey(desc, m[2].trim());
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return counts;
}

// 「新竹縣尖石鄉秀巒村」→ 由細到粗的查詢階梯,愈細的命中就愈精確
function ladder(key) {
  const m = key.match(/^(.{1,3}[縣市])(.{1,4}[鄉鎮市區])?(.{1,6}[村里])?$/);
  if (!m) return [];
  const [, county, town, village] = m;
  const steps = [];
  if (village) steps.push({ q: county + town + village, level: 'village', must: [county, town] });
  if (town) steps.push({ q: county + town, level: 'town', must: [county] });
  steps.push({ q: county, level: 'county', must: [] });
  return steps;
}

async function nominatim(q) {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&countrycodes=tw&addressdetails=0&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
  if (res.status === 429) { await sleep(5000); return null; }
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit || null;
}

// 只採信行政區界的結果,而且回傳的地址要真的包含我們指定的縣市/鄉鎮,
// 否則 Nominatim 常會拿同名的學校或商店來充數。
function acceptable(hit, step) {
  if (!hit || hit.category !== 'boundary' || hit.type !== 'administrative') return false;
  const name = String(hit.display_name || '');
  return step.must.every((token) => name.includes(token) || name.includes(token.replace(/^臺/, '台')));
}

const table = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const counts = collectKeys();
const pending = [...counts.entries()]
  .filter(([key]) => !(key in table))
  .sort((a, b) => b[1] - a[1])
  .slice(0, limit);

console.log(`地名總數 ${counts.size},已有 ${Object.keys(table).length},本次待查 ${pending.length}`);

let hit = 0;
let miss = 0;
for (const [i, [key]] of pending.entries()) {
  let found = null;
  for (const step of ladder(key)) {
    const res = await nominatim(step.q);
    await sleep(1100); // Nominatim: 每秒至多一次
    if (acceptable(res, step)) {
      found = [Number(Number(res.lat).toFixed(5)), Number(Number(res.lon).toFixed(5)), step.level];
      break;
    }
  }
  if (found) { table[key] = found; hit += 1; }
  else { miss += 1; }
  if ((i + 1) % 25 === 0 || i === pending.length - 1) {
    fs.writeFileSync(OUT, JSON.stringify(table, Object.keys(table).sort(), 0) + '\n');
    console.log(`  ${i + 1}/${pending.length}  命中 ${hit} / 未中 ${miss}  最後: ${key} → ${found ? found.join(',') : '無'}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(table, Object.keys(table).sort(), 0) + '\n');
const levels = {};
for (const v of Object.values(table)) levels[v[2]] = (levels[v[2]] || 0) + 1;
console.log(`完成:${Object.keys(table).length} 筆,層級分布`, levels);

// 落點必須在台灣範圍內,否則是查錯了
const outside = Object.entries(table).filter(([, v]) => v[0] < 20 || v[0] > 27 || v[1] < 117 || v[1] > 123.5);
if (outside.length) console.warn('警告:落在台灣範圍外', outside.slice(0, 10));
