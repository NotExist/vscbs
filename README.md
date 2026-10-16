# 災防告警地圖 (vscbs)

以 OpenStreetMap 逐筆呈現台灣災防告警細胞廣播（CBS）訊息的發布範圍，並可回顧 2017 年 1 月以來的歷史月彙整。

資料來源：NCDR 透過 [cbs.tw](https://cbs.tw/) 發布的 Atom feed。

## 它做什麼

- **最新告警** — `rssatomfeed.xml` 的當前有效告警，逐筆畫出 `circle` / `polygon` 發布範圍（更新時機見下）。
- **歷史回顧** — `list.xml` 索引的 116 個月彙整（2017-01 起，共 55,000+ 筆），同一套介面切換月份檢視。
- **清單與地圖雙向連動** — 滑過清單時地圖照常顯示全部、只加粗該筆；點清單飛到該筆範圍並只留該筆；點地圖範圍則地圖不動、其他告警照常顯示，只加粗標示並捲到該筆卡片（點空白處取消）。地圖 tooltip 以發布時間開頭。
- **完整發布區域** — 展開一筆時逐一列出所有區域與其幾何類型／落點層級，超過 10 個時其餘折疊。
- **限定地圖範圍** — 涵蓋內政部行政區資料全境（北至馬祖、東至釣魚臺、南至南沙太平島）並留約 1° 餘裕，拖出界放手會彈回；最小縮放 7。
- **篩選** — 事件類型、發送頻道、日期（含每日筆數的長條）、關鍵字（標題／發布單位／內文／區域名）。
  測試訊息預設隱藏，按「含測試」顯示；判定依據見〈發送頻道與測試訊息〉。
- **可分享的網址** — 月份、篩選、選取的那一筆都寫在 hash 裡。
- **官方告警說明** — 事件名稱採 cbs.tw 官方告警類型清單；展開一筆時附上該類型的發布條件與應變建議。

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

1. `npm run mirror` 抓 `list.xml`、`rssatomfeed.xml`、官方告警類型說明與當月／上月彙整（其餘月份已在版本庫，只補缺漏），共約 5 個請求。
2. 補查新地名座標、跑 `npm test`。
3. **資料有變才** commit 回 `main` 並部署；沒變就結束，不產生空 commit 或空部署。

### 當月資料：即時 feed 累積與對帳

即時 feed 只保留最近幾天的告警，官方月彙整要到次月初才出現，兩者之間的當月資料沒有官方來源。
因此每次抓到的即時 feed 告警，會依發布月份（台北時間）併入 `data/current/atom-YYYYMM.xml`：與月彙整同格式，
entry 原樣保存，已收過的 id 不覆寫。歷史回顧的月份選單把它標成「累積中 N 筆」。每次取得的即時 feed 原檔都留在
`data/rssatomfeed.xml` 的 git 歷史中，可供追溯。

官方月彙整出現在 `list.xml` 後，`mirror.py` 先逐筆比對 id，寫出對帳報告 `data/reconcile/YYYYMM.json`，
內容包括官方與累積的筆數、命中率、漏掉的告警（含類型）與只在累積裡的告警，然後刪除累積檔，改用官方版本。

**累積是 best effort**：即時 feed 不會在告警失效時移除它，而是**不定期批次清除**，一次拿掉某個時間點以前的全部告警
（推測人工清理，沒有固定門檻）。2026-10 觀察到的兩次都清掉已過期約 3–9 天以上的告警，但不保證有最短保留期間。
排程設定每小時、GitHub 實際觸發間隔最長約 9 小時，實務上幾乎都收得到；會漏的是發布後很快被清掉或撤下的特例。
完整性以官方月彙整為準，累積只是月彙整出現前的暫代，更新與留存都不另做保證；對帳報告用來看兩者差多少。cbs.tw 網頁的當月 JSON
（`/public/upload/files/json/YYYYMM.json`）涵蓋完整，但格式是網站自己的、沒有行政區代碼，目前只列為備用參考。

`data/` 因此**進版本庫**。116 個以上的歷史月彙整（60 多 MB）寫定後就不再變動，進版控是一次性成本；
之後每小時最多新增一個小 commit（主要是幾十 KB 的 `rssatomfeed.xml`）。

本地手動更新：

```sh
npm run mirror && npm run geocode && npm test
git commit -am "更新告警資料" && git push    # push 即觸發部署
```

## 官方告警類型說明

[`alertTypesList.json`](https://cbs.tw/public/upload/files/json/alertTypesList.json) 是 cbs.tw 官方的告警類型清單，
鏡像為 `data/alert-types.json`，與其他來源一起每小時更新。每種類型有中文名稱、發布機關、發布條件（`alertDesc`）
與應變建議（`alertRecommend`）。

- `alertType` 去掉 `alert_type_` 前綴後，**不分大小寫**對應 CAP 的 eventCode（`alert_type_earthquakeew` ↔ `earthquakeEW`）。
- 說明欄位是後台編輯器存出的 HTML（含 `xss=removed` 殘留、`<wbr>`、Gmail 轉址連結），`assets/catalog.js` 轉成純文字、
  保留條列換行，顯示前一律跳脫，不把來源 HTML 直接插入頁面。
- 官方清單只有 26 種；歷史資料中另有 `earthquake`、`emergSupport`、`AMLPlntDiseas`、`systemTest` 四種已不在清單上，
  沿用 `catalog.js` 從資料 `<title>` 歸納的名稱。
- `filename`（類型圖示）目前用不上：試過的路徑都只回網站首頁 HTML，實際位置不明。

## 發送頻道與測試訊息

頻道（CBS 訊息碼）的分類依 NCDR 規劃、NCC 公告（[台灣電信產業發展協會整理](http://www.emfsite.org.tw/PWS/p1-3.html)），
與 3GPP TS 23.041 一致：

| 訊息碼 | 分類 |
| --- | --- |
| 911／919 | 警訊通知（中文／英文） |
| 4370／4383 | 國家級警報（中文／英文） |
| 4371–4379／4384–4392 | 緊急警報（中文／英文） |
| 4380／4393 | 每月測試（中文／英文） |

早期資料的頻道 `0` 不在表內，顯示原始代碼。

**測試訊息**只依兩個明確定義判斷：頻道是 4380／4393，或事件類別為 `systemTest`。資料裡 4370、4371、919、4384 等頻道上
也出現過 `systemTest`，那不代表這些頻道是測試用（可能是官方誤用或特定演練），所以只藏那幾筆、不藏整個頻道。
4380 上另有 2 筆事件類別填 `debrisFlow` 的訊息（2017-12、2018-02），內文都是「災防告警訊息測試」，佐證頻道定義。

## 地理定位

CAP 訊息的 `<area>` 有兩類寫法：

| 來源 | 佔比 | 地圖呈現 |
| --- | --- | --- |
| `<polygon>` / `<circle>` | 約 30% | 訊息自帶的實際範圍，實線 |
| `<geocode>` 行政區代碼（村里 `1000813-012`／鄉鎮 `1000813`／縣市 `10008`） | 約 70% | **以代碼查內政部行政區界，畫出該村里／鄉鎮／縣市的界線**（實線）。行政區代碼的發布範圍就是該行政區本身，所以這也是實際範圍 |
| 上述代碼查不到（極少數） | 30 次 | 地名查表的概略落點，虛線圈，介面標示村里／鄉鎮／縣市概略位置 |

### 範圍可能不完整的告警

官方 CAP 對多區域發布的訊息常只留一個代表代碼。例如每月全國測試只給金門 `09020`，`areaDesc` 是 `Test_Geocode`；
海嘯分區（如「海峽沿海地區」）只給 1 個代碼，cbs.tw 網站卻列出 46 個鄉鎮。完整區域只在 cbs.tw 網站自己的資料
（`/public/upload/files/json/YYYYMM.json` 的 `area_text`、KML）裡。

前端無法從 CAP 得知完整範圍，只能標示：只有行政區代碼、且某個 `areaDesc` 不是行政區名（不以縣／市／鄉／鎮／區／村／里結尾，
「地區」除外）的告警，卡片標「範圍可能不完整」，詳細面板說明並指向原始訊息頁面。以 cbs.tw 資料對照 8 個月驗證：
真正少列區域的 77 筆標到 75 筆（未標的 2 筆其實是名稱寫法差異），另有約 30 筆誤標，多為實際只發一個縣市的「地震速報廣播範圍」，
所以文字寫「可能」。全部歷史約 712 筆會被標示。以 `area_text` 補齊範圍列為後續考量。

### 內政部行政區界（`data/admin/`）

`scripts/build-admin.py` 下載內政部的
[村里界圖](https://data.gov.tw/dataset/7438)與[鄉鎮市區界線](https://data.gov.tw/dataset/7441)（TWD97 經緯度，
含金門、連江），簡化到約 50 m 精度後依縣市分成 22 個檔（共約 4 MB），每個行政區存
`[代表點 lat, lon, 邊界多邊形]`。代表點用 polylabel 求出，保證落在界內。前端只載入當前資料用得到的縣市檔。

代碼換算（CAP 的 Taiwan_Geocode_103 ↔ 內政部）：

| | CAP | 內政部 |
| --- | --- | --- |
| 一般縣市的鄉鎮／村里 | `1000813` / `1000813-012` | `TOWNCODE 10008130` / `VILLCODE 10008130012` |
| 直轄市的區／里 | `6301100` / `6301100-003` | `TOWNCODE 63000110` / `VILLCODE 63000110003` |

以代碼查，不比對地名，所以全形空白、異體字（石硦／石弄、霧台／霧臺）、OSM 缺漏都不影響。
2017 年以來 39,266 次行政區代碼中，39,236 次（99.9%）直接命中。內政部改版（約每季到每年）時跑 `npm run admin` 重建；
排程不需要它。

最重的月份（2017-06）要畫 6,530 個行政區多邊形、約 37 萬個頂點，並載入 13 個縣市檔（約 3.2 MB，gzip 後約 0.7 MB）。
Leaflet 的 canvas renderer 會依縮放層級再簡化，一般月份只有數百個多邊形。

### 後備：地名查表（`data/places.json`）

查不到代碼的只剩 30 次，全是 2018-04 臺南市一則測試告警裡、該年里整編前的舊里代碼。這些改用 `areaDesc` 地名向
Nominatim 查（`scripts/geocode-places.mjs`，只接受 `boundary/administrative` 結果），查不到村里就退到鄉鎮，
目前 29 個地名（3 村里／26 鄉鎮）。腳本會自動略過代碼已涵蓋的地名，並把不再需要的條目移出表外；
兩者都查不到才退回縣市概略中心。

## 本地開發

```sh
npm install          # 只有 jsdom,供測試用;網站本身沒有建置步驟
npm run mirror       # 抓來源檔到 data/(uv + curl_cffi;已有的月檔只補缺漏)
npm run geocode      # 補齊 data/places.json 的後備地名座標(遵守 Nominatim 每秒一次)
npm run admin        # 重建 data/admin/ 行政區界(內政部改版時才需要;uv + pyshp + shapely)
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
- 行政區界：內政部國土測繪中心（[政府資料開放授權條款第 1 版](https://data.gov.tw/license)）
- 後備地名座標：Nominatim / OpenStreetMap
- [Leaflet](https://leafletjs.com/) 1.9.4（BSD-2-Clause），已內嵌於 `vendor/`
