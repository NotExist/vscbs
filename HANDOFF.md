# HANDOFF — vscbs

> 單一事實來源。每次 recap／session 收尾就地更新本檔。

## 當前狀態（2026-09-01）

**功能已完成，測試全過，尚未部署** — 等 user 確認後才首次部署（user 明確要求）。

- 前端完成：最新告警 + 歷史回顧雙模式、清單↔地圖雙向連動、事件類型／日期／關鍵字篩選、網址狀態保存。
- `npm test`（jsdom smoke test）全數通過，涵蓋載入、篩選、選取、切月、搜尋、網址還原。
- 資料鏡像腳本與 GitHub Actions workflow 已就緒，**尚未 `git init`、尚未建 remote、尚未部署**。
- `data/places.json` 的地理編碼**仍在跑**（背景 job，1055 個地名，Nominatim 每秒一次，約需 40–60 分鐘）。
  未查完的地名會退回縣市層級顯示，功能不受影響。

## 已定案的決策

| 決策 | 理由 |
| --- | --- |
| GitHub Pages + Actions 鏡像資料 | cbs.tw 無 CORS，無法純前端直連。此法零第三方依賴，代價是最新資料延遲 10–20 分鐘 |
| 用 Pages artifact 部署，資料不進版本庫 | 每 10 分鐘 commit 一次 XML 會讓 git 歷史爆掉；改用 Actions 快取保存 62MB 的月彙整 |
| 地理編碼在建置階段做完 | 瀏覽器不打 Nominatim；結果存 `data/places.json`，唯一進版本庫的資料檔 |
| Leaflet 內嵌 `vendor/` 而非 CDN | 與鏡像資料同一個理念：站台除了 OSM 圖磚沒有外部依賴 |
| 只標註 4370／4371 兩個頻道語意 | 其餘代碼（911／919／0）語意無公開明確定義，不臆測，顯示原始代碼 |

## 下一步

1. **等 user 確認後首次部署**：`git init` → commit → 建 GitHub repo → push →
   Settings → Pages → Source 選 GitHub Actions。首次 workflow 要抓 62MB，約數分鐘。
2. 部署後在真實瀏覽器確認視覺與地圖互動（開發環境無瀏覽器，目前只有 jsdom 層級的驗證）。

## 已知限制／可能的後續

- **最新告警延遲 10–20 分鐘**（GitHub 排程精度）。要即時就得改用 Cloudflare Worker 反代 cbs.tw 補 CORS
  標頭，前端只需改 `assets/app.js` 的 `DATA` 常數。這是 user 當初的次選方案，留作升級路徑。
- **約 1% 的告警只能落到縣市中心**（`areaDesc` 是「地震速報廣播範圍」這類非地名，或 OSM 查無該村里）。
  已在卡片與詳情據實標示，不假裝是實際範圍。
- 歷史月份單月最多 1436 筆，清單以 120 筆分頁增量渲染；地圖用 canvas renderer 一次畫完篩選結果。
- GitHub 會停用連續 60 天無 commit 的 repo 排程，屆時需手動觸發一次 workflow。

## 里程碑

- **2026-09-01** — 專案從零建立：確認 cbs.tw 無 CORS 並選定鏡像方案、解析 55,008 筆歷史告警驗證解析器
  （零壞資料）、補齊 30 個 eventCode 對照、建立建置期地理編碼、完成前端與 smoke test。
