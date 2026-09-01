# HANDOFF — vscbs

> 單一事實來源。每次 recap／session 收尾就地更新本檔。

## 當前狀態（2026-09-01）

站台已部署：**https://notexist.github.io/vscbs/**（repo `NotExist/vscbs`，public）

- 前端完成：最新告警 + 歷史回顧雙模式、清單↔地圖雙向連動、事件類型／日期／關鍵字篩選、網址狀態保存。
- `npm test`（jsdom smoke test）25 項全過。
- 資料（116 個月彙整 + 最新 feed + `places.json`）已進版本庫，CI 只負責發布。
- **最新告警目前是手動更新**——自動化方式尚未定案，見下方「下一步」。

## 路上撞到的牆：cbs.tw 擋 GitHub Actions

原訂讓 Actions 每 10 分鐘鏡像資料，實測**行不通**：

- cbs.tw 在 Cloudflare 後面，對 Actions 的 Azure 出口 IP 回 `403` + `cf-mitigated: challenge`
  （Managed Challenge，「Just a moment...」）。**連首頁都擋，換任何 User-Agent／標頭組合都無效**，
  已用診斷 workflow 逐一驗證過七種組合。
- 從台灣的一般網路（sandbox 走 HiNet AS3462）則完全暢通。
- 上游的 `alerts.ncdr.nat.gov.tw/RSS.aspx` 已下線（302 導向網頁首頁），沒有替代來源。

因此改成：**能連通的機器跑 `scripts/mirror.sh` → commit → push 觸發部署**。
歷史月彙整寫定後不再變動，進版本庫反而比每次重抓合理；真正需要更新的只有 137KB 的 `rssatomfeed.xml`。

## 已定案的決策

| 決策 | 理由 |
| --- | --- |
| 資料進版本庫，CI 只發布 | cbs.tw 擋 Actions（見上）。62MB 的歷史月檔是不變資料，進版控是一次性成本 |
| 地理編碼在建置階段做完 | 約 69% 的告警沒有經緯度，只給行政區代碼加 `areaDesc` 地名。照代碼直譯會讓七成資料疊在 22 個縣市中心 |
| `placeKey` 去掉所有空白（含全形） | 資料裡「南投縣　信義鄉　神木村」與無空格版本是同一地點，不正規化會讓 169 個村里白白退到鄉鎮層級 |
| Leaflet 內嵌 `vendor/` 而非 CDN | 站台除了 OSM 圖磚沒有外部依賴 |
| 只標註 4370／4371 兩個頻道語意 | 其餘代碼（911／919／0）語意無公開明確定義，不臆測，顯示原始代碼 |
| eventCode 中文名取自資料實際出現的 `<title>` | 不自行翻譯，見 `assets/catalog.js` |

## 下一步

1. **在真實瀏覽器確認視覺與地圖互動**——開發環境無瀏覽器，目前只有 jsdom 層級的驗證。
2. **決定最新告警的自動更新方式**（三個選項，都需要 user 的資源）：
   - self-hosted runner：在台灣網路的機器跑 Actions runner，鏡像步驟加回 workflow
   - 自家 cron：機器上定時 `npm run mirror && git commit && git push`
   - Cloudflare Worker：定時抓取存 R2／KV，前端改讀 Worker。**能否繞過 Cloudflare 挑戰需實測**
     （Worker 出口未必落在台灣）；若可行，順帶解決即時性

## 已知限制

- **約 1% 的告警只能落到縣市中心**（`areaDesc` 是「地震速報廣播範圍」這類非地名，或 OSM 查無該村里）。
  已在卡片與詳情據實標示，不假裝是實際範圍。
- 地名座標 931 筆：585 村里 / 311 鄉鎮 / 35 縣市；1055 個地名中 124 個查無，退回縣市中心。
- 歷史月份單月最多 1436 筆，清單以 120 筆分頁增量渲染；地圖用 canvas renderer 一次畫完篩選結果。

## 里程碑

- **2026-09-01** — 專案從零建立並上線。確認 cbs.tw 無 CORS、解析 55,008 筆歷史告警驗證解析器（零壞資料）、
  補齊 30 個 eventCode 對照、建立建置期地理編碼（931 筆地名）、完成前端與 25 項 smoke test。
  首次部署時撞上 Cloudflare 擋 Actions，改成資料進版本庫、CI 只發布。
