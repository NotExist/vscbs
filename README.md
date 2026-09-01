# 災防告警地圖 (vscbs)

以 OpenStreetMap 逐筆呈現台灣災防告警細胞廣播（CBS）訊息的發布範圍，並可回顧 2017 年 1 月以來的歷史月彙整。

資料來源：NCDR 透過 [cbs.tw](https://cbs.tw/) 發布的 Atom feed。

## 它做什麼

- **最新告警** — `rssatomfeed.xml` 的當前有效告警，逐筆畫出 `circle` / `polygon` 發布範圍。
- **歷史回顧** — `list.xml` 索引的 116 個月彙整（2017-01 起，共 55,000+ 筆），同一套介面切換月份檢視。
- **清單與地圖雙向連動** — 點清單飛到該筆範圍，點地圖範圍捲到該筆卡片。
- **篩選** — 事件類型、日期（含每日筆數的長條）、關鍵字（標題／發布單位／內文／區域名）。
- **可分享的網址** — 月份、篩選、選取的那一筆都寫在 hash 裡。

## 為什麼需要鏡像資料

cbs.tw 的回應**沒有 `Access-Control-Allow-Origin` 標頭**，而且帶 `cross-origin-resource-policy: same-site`。
瀏覽器因此無法從別的網域直接 `fetch` 它的 XML。

解法是在 CI 把來源檔鏡像下來，跟前端一起發布成同源的靜態站台
（`.github/workflows/deploy.yml`，每 10 分鐘一次；GitHub 排程有數分鐘誤差，實際更新間隔約 10–20 分鐘）。
好處是站台完全靜態、沒有第三方 proxy 依賴；代價是最新告警有這段延遲。

若日後需要即時性，可改用 Cloudflare Worker 反代 cbs.tw 並補上 CORS 標頭，
前端只需把 `assets/app.js` 的 `DATA` 常數指到該 Worker。

## 地理定位的三種來源

CAP 訊息的 `<area>` 有三種寫法，精度差很多，介面上會據實標示：

| 來源 | 佔比 | 地圖呈現 |
| --- | --- | --- |
| `<polygon>` / `<circle>` | 約 30% | 實線，就是訊息宣告的實際範圍 |
| `<geocode>` + 地名（如「新竹縣尖石鄉秀巒村」） | 約 69% | 虛線圈，落在該村里／鄉鎮中心 |
| `<geocode>` 只有代碼、地名無法解析 | 約 1% | 較大的虛線圈，落在縣市概略中心 |

第二類的座標由 `scripts/geocode-places.mjs` 在**建置階段**向 Nominatim 查好，存成 `data/places.json`；
瀏覽器只查表，不打任何地理編碼服務。查詢只接受 `boundary/administrative` 且地址確實包含指定縣市／鄉鎮的結果，
村里查不到時退到鄉鎮、再退到縣市，並把實際命中的層級記在表裡供介面標示。

## 本地開發

```sh
npm install          # 只有 jsdom,供測試用;網站本身沒有建置步驟
npm run mirror       # 抓來源檔到 data/(首次約 62MB / 116 個月檔)
npm run geocode      # 補齊 data/places.json 的地名座標(遵守 Nominatim 每秒一次)
npm test             # 在 jsdom 裡把整個頁面跑一遍
npm run serve        # http://localhost:8080
```

`data/` 的 XML 不進版本庫（由 CI 鏡像並快取），只有 `data/places.json` 例外——
它是地理編碼的種子，少了它每次快取失效都得對 Nominatim 重查上千次。

## 部署

推到 GitHub 後，在 repo 的 **Settings → Pages → Source** 選 **GitHub Actions**，
workflow 就會鏡像資料並發布。首次執行要抓完 116 個月檔，約需數分鐘；之後靠 Actions 快取增量更新。

> GitHub 會停用連續 60 天沒有 commit 的 repo 排程，屆時需手動觸發一次 workflow 恢復。

## 授權與出處

- 告警資料：NCDR / cbs.tw
- 底圖：© OpenStreetMap contributors（[ODbL](https://www.openstreetmap.org/copyright)）
- 地名座標：Nominatim / OpenStreetMap
- [Leaflet](https://leafletjs.com/) 1.9.4（BSD-2-Clause），已內嵌於 `vendor/`
