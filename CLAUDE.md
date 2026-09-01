# vscbs — 災防告警地圖

純靜態網站：以 OSM 逐筆呈現台灣災防告警細胞廣播（CBS）訊息的發布範圍，並可回顧 2017 年以來的歷史。

**當前狀態與下一步一律看 [`HANDOFF.md`](HANDOFF.md)（單一事實來源）。**
專案背景、資料格式、部署方式看 [`README.md`](README.md)。

## 這個專案的三個關鍵前提

1. **cbs.tw 不回 CORS 標頭**（且帶 `cross-origin-resource-policy: same-site`），瀏覽器無法直連。
   所有資料靠 `.github/workflows/deploy.yml` 在 CI 鏡像成同源檔案。改動資料來源時務必記得這件事。
2. **兩種來源的 Atom 欄位寫法不同**：`rssatomfeed.xml` 用 `<link rel="alternate" href="URL"/>`，
   月彙整用 `<link ref="alternate">URL</link>`（注意是 `ref`，而且值在文字節點）。`assets/parse.js` 兩種都吃。
3. **約 69% 的告警沒有經緯度**，只有行政區代碼加 `areaDesc` 地名。座標在建置階段查好存進
   `data/places.json`，前端只查表。介面必須據實標示落點是村里／鄉鎮／縣市層級，不可讓它看起來像實際範圍。

## 慣例

- 無建置步驟：原生 ES modules + 原生 CSS，Leaflet 內嵌在 `vendor/`。改完直接 `npm run serve` 就看得到。
- 改動前端後跑 `npm test`（jsdom 把整頁跑一遍，會抓到執行期錯誤與連動失效）。
- 對照表（eventCode 中文名等）以資料中實際出現過的值為準，不自行翻譯，見 `assets/catalog.js`。
