# vscbs — 災防告警地圖

純靜態網站：以 OSM 逐筆呈現台灣災防告警細胞廣播（CBS）訊息的發布範圍，並可回顧 2017 年以來的歷史。

**當前狀態與下一步一律看 [`HANDOFF.md`](HANDOFF.md)（單一事實來源）。**
專案背景、資料格式、部署方式看 [`README.md`](README.md)。

## 這個專案的三個關鍵前提

1. **cbs.tw 不回 CORS 標頭，且依 TLS 指紋擋非瀏覽器客戶端**。前者（加上 `cross-origin-resource-policy: same-site`）
   讓瀏覽器無法直連，所以資料必須鏡像成同源檔案。後者讓 curl 換任何 UA 都回 `403`，所以 `scripts/mirror.py`
   用 curl_cffi 模仿 Chrome 指紋抓取。Actions 每小時抓一次，有變才 commit 回 `main` 並部署，`data/` 進版本庫。
   cbs.tw 也擋 HEAD，一律用 GET。（曾一度誤判為依 IP 擋 Actions，2026-10-11 實測推翻，見 HANDOFF。）
2. **兩種來源的 Atom 欄位寫法不同**：`rssatomfeed.xml` 用 `<link rel="alternate" href="URL"/>`，
   月彙整用 `<link ref="alternate">URL</link>`（注意是 `ref`，而且值在文字節點）。`assets/parse.js` 兩種都吃。
3. **約 70% 的告警沒有經緯度**，只有行政區代碼（Taiwan_Geocode_103）加 `areaDesc` 地名。前端以代碼查
   `data/admin/<縣市>.json`（內政部村里／鄉鎮界，`scripts/build-admin.py` 產生，99.9% 命中）；查不到才用
   `data/places.json`（Nominatim 地名後備）。代碼換算規則見 README〈地理定位〉。

## 慣例

- 無建置步驟：原生 ES modules + 原生 CSS，Leaflet 內嵌在 `vendor/`。改完直接 `npm run serve` 就看得到。
- 改動前端後跑 `npm test`（jsdom 把整頁跑一遍，會抓到執行期錯誤與連動失效）。
- eventCode 中文名以官方 `data/alert-types.json` 為準；官方沒有的舊類型才用資料中實際出現過的 `<title>`，不自行翻譯，見 `assets/catalog.js`。
