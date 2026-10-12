// Leaflet + OSM 的圖層管理:一筆告警可能有多個區域,全部掛同一個 id 以便雙向連動。
import { eventInfo } from './catalog.js';

const TAIWAN_VIEW = { center: [23.7, 120.96], zoom: 7 };
// 可拖曳範圍:涵蓋內政部行政區資料全境(南沙太平島 114.36°E/10.37°N、釣魚臺 124.56°E、馬祖 26.39°N),
// 外側各留約 1° 讓邊緣的島也能拉到畫面中央(maxBounds 限制的是整個可視區,不是中心點)。
// viscosity 0 = 可拖出界,放手後彈回(同 cbs.tw 的設定)
const MAX_BOUNDS = [[9.5, 113.5], [27.5, 125.5]];

export function createMap(el, { onSelect, formatTime } = {}) {
  const map = L.map(el, {
    preferCanvas: true, // 上千個 polygon 時 canvas 比 SVG 穩
    maxBounds: MAX_BOUNDS,
    maxBoundsViscosity: 0,
    minZoom: 7,
    zoomControl: true,
    attributionControl: true,
  }).setView(TAIWAN_VIEW.center, TAIWAN_VIEW.zoom);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // 平常顯示 group(全部結果);聚焦某一筆時把 group 整個拿下,只把那筆的圖層放進 focusGroup
  const group = L.layerGroup().addTo(map);
  const focusGroup = L.layerGroup();
  let byId = new Map(); // id → { layers, bounds }
  let selectedId = null;
  let hoveredId = null;
  let focusedId = null;

  const baseStyle = (color, approx) => ({
    color,
    weight: approx ? 1 : 1.6,
    opacity: 0.8,
    fillColor: color,
    fillOpacity: 0.12,
    dashArray: approx ? '4 4' : null,
  });

  const activeStyle = (color) => ({
    color,
    weight: 3,
    opacity: 1,
    fillColor: color,
    fillOpacity: 0.32,
    dashArray: null,
  });

  function applyStyle(id, active) {
    const rec = byId.get(id);
    if (!rec) return;
    for (const layer of rec.layers) {
      layer.setStyle(active ? activeStyle(rec.color) : baseStyle(rec.color, layer.approx));
      if (active && layer.bringToFront) layer.bringToFront();
    }
  }

  function render(entries) {
    focus(null);
    group.clearLayers();
    byId = new Map();
    selectedId = null;
    hoveredId = null;

    for (const entry of entries) {
      if (!entry.center) continue;
      const { color } = eventInfo(entry.event);
      const layers = [];

      for (const area of entry.areas) {
        let layer = null;
        if (area.kind === 'circle') {
          layer = L.circle(area.center, { radius: Math.max((area.radiusKm || 0) * 1000, 150) });
        } else if (area.kind === 'polygon') {
          layer = L.polygon(area.ring);
        } else if (area.kind === 'geocode' && area.shape) {
          layer = L.polygon(area.shape); // 內政部行政區界,就是發布範圍本身
        } else if (area.kind === 'geocode' && area.approx) {
          // 只有行政區代碼、沒有精確幾何:用虛線圈標出概略位置,不假裝是實際範圍。
          // 圈的大小反映落點精度:對到村里就小,只能對到縣市就大。
          const radius = { village: 6, town: 9 }[area.approx.level] || 14;
          layer = L.circleMarker([area.approx.lat, area.approx.lon], { radius });
        }
        if (!layer) continue;
        // 虛線只給概略落點;同一筆裡實際範圍與概略落點可能並存,逐圖層判斷
        layer.approx = area.kind === 'geocode' && !area.shape;
        layer.setStyle(baseStyle(color, layer.approx));
        const time = entry.sentAt && formatTime ? `${formatTime(entry.sentAt)}　` : '';
        // 字串形式的 tooltip 會被當 HTML 插入,來源文字要先跳脫
        layer.bindTooltip(esc(`${time}${entry.title}${area.desc ? ` — ${area.desc}` : ''}`), { sticky: true });
        layer.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev); // 別讓地圖本身的 click 把選取清掉
          onSelect?.(entry.id);
        });
        layers.push(layer);
        group.addLayer(layer);
      }

      if (!layers.length) continue;
      let bounds = null;
      for (const layer of layers) {
        const b = layer.getBounds ? layer.getBounds() : L.latLngBounds([layer.getLatLng(), layer.getLatLng()]);
        bounds = bounds ? bounds.extend(b) : b;
      }
      byId.set(entry.id, { layers, bounds, color });
    }
    return byId.size;
  }

  function select(id, { fly = true } = {}) {
    if (selectedId && selectedId !== id && selectedId !== hoveredId) applyStyle(selectedId, false);
    selectedId = id;
    if (!id) return;
    applyStyle(id, true);
    const rec = byId.get(id);
    if (fly && rec?.bounds?.isValid()) {
      map.flyToBounds(rec.bounds, { padding: [60, 60], maxZoom: 13, duration: 0.6 });
    }
  }

  function fitAll() {
    // 必須複製一份:L.latLngBounds() 傳入 LatLngBounds 會原樣回傳,
    // 直接 extend 會把該筆自己的範圍撐成全部的聯集
    let bounds = null;
    for (const rec of byId.values()) {
      bounds = bounds
        ? bounds.extend(rec.bounds)
        : L.latLngBounds(rec.bounds.getSouthWest(), rec.bounds.getNorthEast());
    }
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    else map.setView(TAIWAN_VIEW.center, TAIWAN_VIEW.zoom);
  }

  // 只留下指定那一筆的圖層;id 為 null 時恢復顯示全部
  function focus(id) {
    const rec = id ? byId.get(id) : null;
    const next = rec ? id : null;
    if (next === focusedId) return;
    focusedId = next;
    focusGroup.clearLayers();
    if (rec) {
      map.removeLayer(group);
      for (const layer of rec.layers) focusGroup.addLayer(layer);
      if (!map.hasLayer(focusGroup)) map.addLayer(focusGroup);
    } else {
      map.removeLayer(focusGroup);
      if (!map.hasLayer(group)) map.addLayer(group);
    }
  }

  // 滑過清單時:其他圖層照常顯示,只把該筆加粗並移到最上層
  function hover(id) {
    const next = id && byId.has(id) ? id : null;
    if (next === hoveredId) return;
    if (hoveredId && hoveredId !== selectedId) applyStyle(hoveredId, false);
    hoveredId = next;
    if (next) applyStyle(next, true);
    else if (selectedId) applyStyle(selectedId, true); // 讓選取那筆回到最上層
  }

  const has = (id) => byId.has(id);

  return {
    map, render, select, focus, hover, fitAll, has,
    focused: () => focusedId,
    invalidate: () => map.invalidateSize(),
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
