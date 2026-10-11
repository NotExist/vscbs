# 災防告警地圖 (vscbs)

以 OpenStreetMap 逐筆呈現台灣災防告警細胞廣播（CBS）訊息的發布範圍，並可回顧 2017 年 1 月以來的歷史月彙整。

資料來源：NCDR 透過 [cbs.tw](https://cbs.tw/) 發布的 Atom feed。

## 它做什麼

- **最新告警** — `rssatomfeed.xml` 的當前有效告警，逐筆畫出 `circle` / `polygon` 發布範圍（更新時機見下）。
- **歷史回顧** — `list.xml` 索引的 116 個月彙整（2017-01 起，共 55,000+ 筆），同一套介面切換月份檢視。
- **清單與地圖雙向連動** — 點清單飛到該筆範圍，點地圖範圍捲到該筆卡片。
- **篩選** — 事件類型、日期（含每日筆數的長條）、關鍵字（標題／發布單位／內文／區域名）。
- **可分享的網址** — 月份、篩選、選取的那一筆都寫在 hash 裡。

## 資料怎麼進來

cbs.tw 的回應**沒有 `Access-Control-Allow-Origin` 標頭**，而且帶 `cross-origin-resource-policy: same-site`，
瀏覽器無法從別的網域直接 `fetch` 它的 XML。所以資料必須先鏡像成同源檔案。

cbs.tw 掛在 Cloudflare 後面，會依 **TLS／HTTP2 指紋**判斷客戶端是不是瀏覽器：curl 的握手特徵一看就不是，
換任何 User-Agent 都回 `403`。`scripts/mirror.py` 因此用 [curl_cffi](https://github.com/lexiforest/curl_cffi)
模仿 Chrome 的指紋，抓到的內容與一般 curl 逐位元相同。這樣從 GitHub Actions 也能直接抓，不需要
headless 瀏覽器。另外 cbs.tw 也擋 HEAD 請求，一律只用 GET。

**後備**：curl_cffi 失敗時，workflow 才臨時 `docker run` 一個 [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr)
（真的 Chrome）重抓並發出 warning，平常不拉 image。它取回的是 Chrome 重新序列化的 XML：位元組不同，
但 C14N 相同、`parse.js` 解析結果完全一致，因此這條路改以 C14N 判斷有無變動，不會造成空 commit。
可在 Actions 手動觸發時選 `fallback_test`：`compare`（兩路比對）或 `simulate`（模擬 curl_cffi 失敗），兩者都不 commit、不部署。

`.github/workflows/deploy.yml` 每小時執行一次：

1. `npm run mirror` 抓 `list.xml`、`rssatomfeed.xml` 與當月／上月彙整（其餘月份已在版本庫，只補缺漏），共約 4 個請求。
2. 補查新地名座標、跑 `npm test`。
3. **資料有變才** commit 回 `main` 並部署；沒變就結束，不產生空 commit 或空部署。

`data/` 因此**進版本庫**。116 個以上的歷史月彙整（60 多 MB）寫定後就不再變動，進版控是一次性成本；
之後每小時最多新增一個小 commit（主要是幾十 KB 的 `rssatomfeed.xml`）。

本地手動更新：

```sh
npm run mirror && npm run geocode && npm test
git commit -am "更新告警資料" && git push    # push 即觸發部署
```

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

### 什麼會重查、什麼不會

`npm run geocode` 只查 `places.json` 裡**還沒有**的鍵，因此：

| 情況 | 會不會重查 | 影響 |
| --- | --- | --- |
| 完全查無、但格式是「縣市＋鄉鎮＋村里」的真地名 | 每次都重查 | OSM 日後補上就會自動命中 |
| `areaDesc` 不是行政區名（「地震資訊廣播範圍」「發布區域1」「北部」「馬祖」等） | 不送查詢 | 解析不出縣市／鄉鎮／村里結構，直接跳過，不耗 Nominatim 額度；前端退回縣市中心。目前 74 個 |
| 村里查不到、**已退到鄉鎮層級存入表中** | **不會**重查 | OSM 日後補上該村里界線也**不會自動升級**。目前 161 個（如桃源區各里） |

想讓第三類升級成村里層級，刪掉表中「層級為 `town` 但鍵以村／里結尾」的條目再重跑：

```sh
node -e '
const fs = require("fs"), p = "data/places.json", t = JSON.parse(fs.readFileSync(p));
for (const [k, v] of Object.entries(t)) if (v[2] === "town" && /[村里]$/.test(k)) delete t[k];
fs.writeFileSync(p, JSON.stringify(t, Object.keys(t).sort()) + "\n");'
npm run geocode      # 161 個約需 3–6 分鐘(每個最多兩次查詢,每秒一次)
```

仍查不到的會照舊退回鄉鎮層級，不會比原本差。

## 本地開發

```sh
npm install          # 只有 jsdom,供測試用;網站本身沒有建置步驟
npm run mirror       # 抓來源檔到 data/(uv + curl_cffi;已有的月檔只補缺漏)
npm run geocode      # 補齊 data/places.json 的地名座標(遵守 Nominatim 每秒一次)
npm test             # 在 jsdom 裡把整個頁面跑一遍
npm run serve        # http://localhost:8080
```

`data/` 整個進版本庫（原因見〈資料怎麼進來〉），更新資料就是跑完上面三步後 commit、push。

## 部署

**Settings → Pages → Source** 選 **GitHub Actions**，之後每次 push 到 `main` 就會發布。

排程每小時自動更新一次（見〈資料怎麼進來〉），也可以在 Actions 頁面手動觸發。

> GitHub 會停用連續 60 天沒有活動的 repo 排程。排程本身有新資料就會 commit，一般不會觸發；
> 若 cbs.tw 長時間沒有新告警，屆時需手動觸發一次 workflow 恢復。

## 授權與出處

- 告警資料：NCDR / cbs.tw
- 底圖：© OpenStreetMap contributors（[ODbL](https://www.openstreetmap.org/copyright)）
- 地名座標：Nominatim / OpenStreetMap
- [Leaflet](https://leafletjs.com/) 1.9.4（BSD-2-Clause），已內嵌於 `vendor/`
