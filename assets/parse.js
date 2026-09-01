// 解析 NCDR/CBS 的 Atom。兩種來源的欄位寫法略有出入,這裡一併吸收:
//   最新告警 rssatomfeed.xml : <link rel="alternate" href="URL"/>
//   月彙整   atom-YYYYMM.xml : <link ref="alternate">URL</link>
import { resolveGeocode, placeKey } from './catalog.js';

// data/places.json:正規化地名 → [lat, lon, level]。載入前為空表,
// 此時 geocode 區域一律退回縣市概略中心。
let PLACES = {};
export function setPlaces(table) { PLACES = table || {}; }

const childrenOf = (node, name) =>
  Array.from(node.children).filter((el) => el.localName === name);

const firstText = (node, name) => {
  const el = childrenOf(node, name)[0];
  return el ? el.textContent.trim() : '';
};

// <sender><value>…</value></sender> 這種包一層 value 的欄位
const wrappedValue = (node, name) => {
  const el = childrenOf(node, name)[0];
  if (!el) return '';
  const inner = childrenOf(el, 'value')[0];
  return (inner ? inner.textContent : el.textContent).trim();
};

const num = (s) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

// "24.83363,121.74483 24.83339,121.7471 …" → [[lat, lon], …]
function parseCoordList(text) {
  const out = [];
  for (const pair of text.trim().split(/\s+/)) {
    const [a, b] = pair.split(',');
    const lat = num(a);
    const lon = num(b);
    if (lat !== null && lon !== null) out.push([lat, lon]);
  }
  return out;
}

// <area> 底下 areaDesc 與幾何是平輩交錯排列,依出現順序配對。
function parseAreas(entry) {
  const areas = [];
  for (const areaEl of childrenOf(entry, 'area')) {
    let desc = '';
    for (const el of areaEl.children) {
      switch (el.localName) {
        case 'areaDesc':
          desc = el.textContent.trim();
          break;
        case 'circle': {
          const [center, radius] = el.textContent.trim().split(/\s+/);
          const pts = parseCoordList(center);
          if (pts.length) {
            areas.push({ kind: 'circle', desc, center: pts[0], radiusKm: num(radius) ?? 0 });
          }
          break;
        }
        case 'polygon': {
          const ring = parseCoordList(el.textContent);
          if (ring.length >= 3) areas.push({ kind: 'polygon', desc, ring });
          break;
        }
        case 'geocode': {
          const value = firstText(el, 'value');
          const place = PLACES[placeKey(desc, value)];
          const county = resolveGeocode(value);
          // 查得到地名就用村里/鄉鎮的中心,查不到才退回縣市
          const approx = place
            ? { lat: place[0], lon: place[1], name: desc, level: place[2] }
            : county
              ? { lat: county.lat, lon: county.lon, name: county.name, level: 'county' }
              : null;
          areas.push({ kind: 'geocode', desc, code: value, scheme: firstText(el, 'valueName'), approx });
          break;
        }
      }
    }
  }
  return areas;
}

// 精確幾何優先;整筆只有行政區代碼時才退回縣市概略中心。
function centroidOf(areas) {
  let sum = [0, 0];
  let n = 0;
  for (const a of areas) {
    if (a.kind === 'circle') {
      sum[0] += a.center[0];
      sum[1] += a.center[1];
      n += 1;
    } else if (a.kind === 'polygon') {
      let la = 0;
      let lo = 0;
      for (const [x, y] of a.ring) {
        la += x;
        lo += y;
      }
      sum[0] += la / a.ring.length;
      sum[1] += lo / a.ring.length;
      n += 1;
    }
  }
  if (n) return { lat: sum[0] / n, lon: sum[1] / n, approx: false };
  const fallback = areas.find((a) => a.kind === 'geocode' && a.approx);
  if (fallback) return { ...fallback.approx, approx: true };
  return null;
}

function parseEntry(entry) {
  const areas = parseAreas(entry);
  const linkEl = childrenOf(entry, 'link')[0];
  const link = linkEl ? (linkEl.getAttribute('href') || linkEl.textContent.trim()) : '';
  const sent = firstText(entry, 'sent');

  return {
    id: firstText(entry, 'id'),
    title: firstText(entry, 'title'),
    sent,
    sentAt: sent ? new Date(sent) : null,
    expires: firstText(entry, 'expires'),
    sender: wrappedValue(entry, 'sender'),
    status: firstText(entry, 'status'),
    msgType: firstText(entry, 'msgType'),
    event: wrappedValue(entry, 'eventCode'),
    channel: wrappedValue(entry, 'channel'),
    text: firstText(entry, 'text') || firstText(entry, 'description'),
    link,
    areas,
    center: centroidOf(areas),
  };
}

export function parseFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 解析失敗');
  const entries = Array.from(doc.documentElement.children)
    .filter((el) => el.localName === 'entry')
    .map(parseEntry)
    .filter((e) => e.id);
  entries.sort((a, b) => (b.sentAt?.getTime() || 0) - (a.sentAt?.getTime() || 0));
  return entries;
}

// list.xml:每個 entry 的 <id> 就是 YYYYMM,對應鏡像檔 data/archive/atom-<id>.xml
export function parseIndex(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  return Array.from(doc.documentElement.children)
    .filter((el) => el.localName === 'entry')
    .map((el) => ({ id: firstText(el, 'id'), title: firstText(el, 'title') }))
    .filter((m) => /^\d{6}$/.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id));
}
