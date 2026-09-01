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

鏡像**不能**在 GitHub Actions 做：cbs.tw 掛在 Cloudflare 後面，對 Actions 的 Azure 出口 IP 一律回
Managed Challenge（`403` + `cf-mitigated: challenge`），連首頁都擋，換任何 User-Agent 都無效。
從台灣的一般網路（例如 HiNet）則暢通。

因此分工是：

| 工作 | 在哪裡做 | 頻率 |
| --- | --- | --- |
| `scripts/mirror.sh` 抓來源檔 | 能連通 cbs.tw 的機器 | 想更新最新告警時 |
| `scripts/geocode-places.mjs` 補地名座標 | 同上 | 出現新地名時 |
| 建置與發布 | GitHub Actions（`push` 觸發） | 每次 commit |

`data/` 因此**進版本庫**。這其實比每次重抓合理：116 個歷史月彙整（62MB）寫定後就不再變動，
真正需要更新的只有 137KB 的 `rssatomfeed.xml`。

更新最新告警的流程就是在能連通的機器上：

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

**Settings → Pages → Source** 選 **GitHub Actions**，之後每次 push 到 `main` 就會發布。

### 想讓最新告警自動更新

目前最新告警是手動 push 更新的。要自動化，得讓抓取跑在**連得到 cbs.tw 的地方**，可能的做法：

- **self-hosted runner** — 在自己（台灣網路）的機器上跑 Actions runner，把鏡像步驟加回 workflow 並指定 `runs-on: self-hosted`。
- **自家 cron** — 機器上定時跑 `npm run mirror && git commit -am … && git push`，push 即觸發部署。
- **Cloudflare Worker** — 由 Worker 定時抓取並存進 R2／KV，前端改讀 Worker。
  能不能繞過 Cloudflare 的挑戰需要實測（Worker 的出口未必落在台灣）。

## 授權與出處

- 告警資料：NCDR / cbs.tw
- 底圖：© OpenStreetMap contributors（[ODbL](https://www.openstreetmap.org/copyright)）
- 地名座標：Nominatim / OpenStreetMap
- [Leaflet](https://leafletjs.com/) 1.9.4（BSD-2-Clause），已內嵌於 `vendor/`
