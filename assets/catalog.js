// 事件類型、發送頻道、行政區代碼的對照。
// 中文名稱取自資料中該 eventCode 實際出現過的 <title>,不是自行翻譯。

export const EVENTS = {
  debrisFlow:   { label: '土石流及大規模崩塌', color: '#a2601c', short: '土石流' },
  Thunderstorm: { label: '雷雨',               color: '#4c6ef5', short: '雷雨' },
  ReservoirDis: { label: '水庫放流',           color: '#0c8599', short: '放流' },
  evacuation:   { label: '疏散避難',           color: '#d6336c', short: '疏散' },
  roadClose:    { label: '道路封閉警戒',       color: '#7048e8', short: '封路' },
  airRaidAlert: { label: '防空',               color: '#495057', short: '防空' },
  tsunami:      { label: '海嘯',               color: '#1864ab', short: '海嘯' },
  CommDisrupt:  { label: '通訊受阻',           color: '#868e96', short: '通訊' },
  barrierLake:  { label: '堰塞湖警報',         color: '#087f5b', short: '堰塞湖' },
  earthquakeEW: { label: '強震即時警報',       color: '#e03131', short: '強震' },
  earthquake:   { label: '地震',               color: '#e03131', short: '地震' },
  largeSurf:    { label: '巨浪',               color: '#1098ad', short: '巨浪' },
  HurricFrcWnd: { label: '颱風等級風力',       color: '#f76707', short: '強風' },
  emergAlert:   { label: '重大災害警報',       color: '#c92a2a', short: '重大' },
  flood:        { label: '淹水警戒',           color: '#1c7ed6', short: '淹水' },
  emergSupport: { label: '緊急應變支援',       color: '#1c7ed6', short: '應變' },
  forestFire:   { label: '森林火災',           color: '#f08c00', short: '林火' },
  industryFire: { label: '工業火災',           color: '#f03e3e', short: '工火' },
  explosion:    { label: '爆炸',               color: '#f03e3e', short: '爆炸' },
  chemical:     { label: '毒災警報',           color: '#5f3dc4', short: '毒災' },
  Nuclear:      { label: '核子事故',           color: '#ae3ec9', short: '核子' },
  airQuality:   { label: '空品警報',           color: '#74b816', short: '空品' },
  communicable: { label: '傳染病',             color: '#0ca678', short: '疫情' },
  IntlEpiAlt:   { label: '國際旅遊疫情',       color: '#0ca678', short: '國際疫情' },
  AMLPlntDiseas:{ label: '動植物疫災',         color: '#66a80f', short: '動植物疫' },
  electric:     { label: '電力中斷',           color: '#f59f00', short: '停電' },
  water:        { label: '緊急停水',           color: '#3bc9db', short: '停水' },
  coldSurge:    { label: '低溫警報',           color: '#4dabf7', short: '低溫' },
  volcano:      { label: '火山',               color: '#d9480f', short: '火山' },
  systemTest:   { label: '系統測試',           color: '#adb5bd', short: '測試' },
};

export const UNKNOWN_EVENT = { label: '其他', color: '#adb5bd', short: '其他' };

export function eventInfo(code) {
  return EVENTS[code] || { ...UNKNOWN_EVENT, label: code || '未分類' };
}

// 只標註公開定義明確的頻道;其餘保留原始代碼,不臆測語意。
export const CHANNELS = {
  '4370': '國家級警報',
  '4371': '緊急警報',
};

export function channelLabel(v) {
  return CHANNELS[v] ? `${CHANNELS[v]} (${v})` : `頻道 ${v}`;
}

// Taiwan_Geocode_103 的縣市層級代碼。座標為該縣市的概略中心,
// 僅在告警沒有 circle/polygon 幾何、只給行政區代碼時作為概略落點使用。
export const COUNTIES = {
  '63000': { name: '臺北市', lat: 25.048, lon: 121.552 },
  '65000': { name: '新北市', lat: 24.968, lon: 121.606 },
  '68000': { name: '桃園市', lat: 24.899, lon: 121.257 },
  '66000': { name: '臺中市', lat: 24.216, lon: 120.898 },
  '67000': { name: '臺南市', lat: 23.108, lon: 120.324 },
  '64000': { name: '高雄市', lat: 23.023, lon: 120.567 },
  '10002': { name: '宜蘭縣', lat: 24.652, lon: 121.647 },
  '10004': { name: '新竹縣', lat: 24.647, lon: 121.157 },
  '10005': { name: '苗栗縣', lat: 24.508, lon: 120.955 },
  '10007': { name: '彰化縣', lat: 23.964, lon: 120.470 },
  '10008': { name: '南投縣', lat: 23.836, lon: 120.977 },
  '10009': { name: '雲林縣', lat: 23.720, lon: 120.348 },
  '10010': { name: '嘉義縣', lat: 23.442, lon: 120.542 },
  '10013': { name: '屏東縣', lat: 22.443, lon: 120.634 },
  '10014': { name: '臺東縣', lat: 22.887, lon: 121.010 },
  '10015': { name: '花蓮縣', lat: 23.786, lon: 121.362 },
  '10016': { name: '澎湖縣', lat: 23.571, lon: 119.579 },
  '10017': { name: '基隆市', lat: 25.113, lon: 121.716 },
  '10018': { name: '新竹市', lat: 24.792, lon: 120.977 },
  '10020': { name: '嘉義市', lat: 23.481, lon: 120.450 },
  '09007': { name: '連江縣', lat: 26.160, lon: 119.951 },
  '09020': { name: '金門縣', lat: 24.437, lon: 118.362 },
};

// 代碼可能是縣市 (5 碼)、鄉鎮市區 (7 碼) 或村里 (帶 dash),
// 一律退回到所屬縣市;查不到就回 null,不硬湊座標。
export function resolveGeocode(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.split('-')[0];
  // 由細往粗:完整代碼 → 縣市 5 碼 → 直轄市的 2 碼前綴(資料中出現過只給 "67" 的寫法)
  const candidates = [digits, digits.slice(0, 5), digits.slice(0, 2) + '000'];
  for (const key of candidates) {
    const hit = COUNTIES[key];
    if (hit) return { ...hit, code: raw, exact: key === raw };
  }
  return null;
}

// 只給行政區代碼的告警,其 areaDesc 通常是「新竹縣尖石鄉秀巒村」這種全名。
// data/places.json 以正規化後的全名為鍵,存放建置階段查好的座標。
// areaDesc 偶爾省略縣市(如「番路鄉」「東區」),此時用代碼推得的縣市補前綴,
// 前後端用同一個函式產生鍵,才能對得上。
const HAS_COUNTY = /^.{1,3}[縣市]/;

export function placeKey(areaDesc, geocodeValue) {
  // 空白一律去掉(含全形):資料裡「南投縣　信義鄉　神木村」與「南投縣信義鄉神木村」是同一個地方
  const desc = String(areaDesc || '').replace(/[\s\u3000]+/g, '');
  if (!desc) return '';
  if (HAS_COUNTY.test(desc)) return desc;
  const county = resolveGeocode(geocodeValue);
  return county ? county.name + desc : desc;
}
