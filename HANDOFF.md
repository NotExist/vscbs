# HANDOFF — vscbs

> 單一事實來源。每次 recap／session 收尾就地更新本檔。

## 當前狀態（2026-10-12）

站台已部署：**https://notexist.github.io/vscbs/**（repo `NotExist/vscbs`，public）

- 前端完成：最新告警 + 歷史回顧雙模式、清單↔地圖雙向連動（滑過或選取時地圖只留該筆，Esc／點地圖空白處取消）、事件類型／日期／關鍵字篩選、網址狀態保存、官方告警說明與應變建議。
- `npm test`（jsdom smoke test）38 項全過。
- 資料（117 個月彙整，至 2026-09 + 最新 feed + `places.json`）進版本庫。
- **Actions 每小時自動抓取**（`scripts/mirror.py`，curl_cffi 模仿 Chrome TLS 指紋），有變才 commit 回 `main` 並部署。

## 路上撞到的牆：cbs.tw 擋非瀏覽器客戶端

- **2026-09-01**：首次部署時 Actions 抓 cbs.tw 一律 `403` + `cf-mitigated: challenge`，七種 UA／標頭組合全敗，
  sandbox（HiNet）卻暢通，當時**誤判為依出口 IP／ASN 擋 Actions**，改成資料手動更新、CI 只發布。
- **2026-10-11 推翻**：在 Actions 上以診斷分支實測三輪（同一台 Azure runner、同一 IP），結果完全一致：

  | 方式 | rssatomfeed | list | atom-202609 |
  | --- | --- | --- | --- |
  | curl + Chrome UA | 200 | 403 | 403 |
  | curl_cffi（模仿 Chrome TLS 指紋） | 200 | 200 | 200 |
  | FlareSolverr `request.get`（真 Chrome） | 200 | 200 | 200 |

  FlareSolverr 每次回 `Challenge not detected!`，**真 Chrome 根本沒被挑戰**、也沒有 `cf_clearance` 可拿。
  所以判斷依據是 **TLS／HTTP2 指紋**，不是 IP。選 curl_cffi：不需 Chrome、數秒完成、內容與 curl 逐位元相同
  （已在 sandbox 比對三個檔案）；FlareSolverr 回傳的是 Chrome 重新序列化的 XML，非逐位元相同，且每次要拉數百 MB 的 image。
- cbs.tw **也擋 HEAD**（GET 才 200），一律用 GET。
- 上游的 `alerts.ncdr.nat.gov.tw/RSS.aspx` 已下線（302 導向網頁首頁），沒有替代來源。

## 已定案的決策

| 決策 | 理由 |
| --- | --- |
| 資料進版本庫，排程抓到新資料才 commit | 歷史月檔是不變資料，進版控是一次性成本；每小時最多一個小 commit，不必靠 Actions 快取 |
| 抓取用 curl_cffi，FlareSolverr 只當後備 | curl_cffi 失敗才 `docker run` 起 FlareSolverr（不用 `services:`，平常不拉 image）。2026-10-11 以 `fallback_test=compare/simulate` 實測：FlareSolverr 取回的 XML 位元組差 1 byte、C14N 相同、`parse.js` 解析結果完全一致；模擬失敗時後備正確接手且判定無變動 |
| concurrency 設在 job 層（update / pages 各一組） | 同組只保留一個排隊中的 run，新的取消舊的；整個 workflow 共用一組會讓排程取消排隊中的 push 部署（實測時 simulate 就取消了 compare） |
| 排程每小時（`23 * * * *`） | user 認定每小時足夠；避開整點的排程擁擠 |
| 地理編碼在建置階段做完 | 約 69% 的告警沒有經緯度，只給行政區代碼加 `areaDesc` 地名。照代碼直譯會讓七成資料疊在 22 個縣市中心 |
| `placeKey` 去掉所有空白（含全形） | 資料裡「南投縣　信義鄉　神木村」與無空格版本是同一地點，不正規化會讓 169 個村里白白退到鄉鎮層級 |
| Leaflet 內嵌 `vendor/` 而非 CDN | 站台除了 OSM 圖磚沒有外部依賴 |
| 只標註 4370／4371 兩個頻道語意 | 其餘代碼（911／919／0）語意無公開明確定義，不臆測，顯示原始代碼 |
| eventCode 中文名以官方 `alertTypesList.json` 為準 | 官方來源優先；官方清單沒有的 4 種舊類型才用資料實際出現的 `<title>`，不自行翻譯 |
| 官方告警說明每小時與 feed 一併鏡像，不當固定資料 | user 要求；檔案很小（139 KB）且官方可能修訂內容 |

## 下一步

1. **在真實瀏覽器確認視覺與地圖互動**——開發環境無瀏覽器，目前只有 jsdom 層級的驗證。
2. **觀察排程穩定度**：curl_cffi 的實測只在單一 runner、短時間內做過。若日後 Cloudflare 規則改變導致失敗，
   workflow 會在「抓取 cbs.tw」步驟紅燈（`mirror.py` 抓不到合法 XML 即非零退出），不會靜默停更。

## 已知限制

- **約 1% 的告警只能落到縣市中心**（`areaDesc` 是「地震速報廣播範圍」這類非地名，或 OSM 查無該村里）。
  已在卡片與詳情據實標示，不假裝是實際範圍。
- 地名座標 931 筆：586 村里 / 310 鄉鎮 / 35 縣市。另有 74 個 `areaDesc` 不是行政區名（廣播範圍描述等），
  不送查詢、退回縣市中心。
- **已退到鄉鎮層級的 160 個村里不會被重查**（`geocode-places.mjs` 只查表中沒有的鍵）。2026-10-12 全數重查一次只升級 1 個：
  未命中主因是該村里在 OSM 只以 POI 地址成分存在（如牛眠里，被只收 `boundary/administrative` 的條件擋掉），
  或名稱已整併更名（如埤頭里），不是 OSM 慢慢補界線，因此**不排程定期重查**。可行改進：接受地址層級含目標村里的 POI 當村里內概略點（未實作）。
- 歷史月份單月最多 1436 筆，清單以 120 筆分頁增量渲染；地圖用 canvas renderer 一次畫完篩選結果。

## 里程碑

- **2026-09-01** — 專案從零建立並上線。確認 cbs.tw 無 CORS、解析 55,008 筆歷史告警驗證解析器（零壞資料）、
  補齊 30 個 eventCode 對照、建立建置期地理編碼（931 筆地名）、完成前端與 25 項 smoke test。
  首次部署時撞上 Cloudflare 擋 Actions，改成資料進版本庫、CI 只發布。
- **2026-10-01** — 依 user 回饋：清單滑過或選取時，地圖只顯示該筆的圖層。
- **2026-10-06** — 補入 2026-09 彙整（141 筆）並更新最新告警；8 月彙整與伺服器比對無變動，9 月無新地名。
- **2026-10-11** — 推翻「cbs.tw 依 IP 擋 Actions」的判斷：實為 TLS 指紋。改用 curl_cffi，Actions 每小時自動抓取並部署。
- **2026-10-11** — 加入 FlareSolverr 後備並實測 compare／simulate 兩種模式通過；concurrency 改為 job 層。
- **2026-10-12** — 161 個鄉鎮層級村里重查，僅 1 個升級；決定不排程重查。
- **2026-10-12** — 鏡像官方告警類型說明 `alertTypesList.json`：事件名稱改用官方名稱，詳情加入發布條件與應變建議。
