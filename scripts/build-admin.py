#!/usr/bin/env python3
"""把內政部的鄉鎮市區界、村里界轉成前端用的行政區檔,存成 data/admin/<縣市代碼>.json。

只有行政區代碼的告警(約七成)靠這份資料定位:以代碼直接查,不比對地名,
所以全形空白、異體字(石硦/石弄)、OSM 缺漏都不再影響。

來源(政府資料開放授權條款第 1 版):
  村里界圖(TWD97經緯度)       https://data.gov.tw/dataset/7438
  鄉鎮市區界線(TWD97經緯度)   https://data.gov.tw/dataset/7441
內政部約每季或每年改版;改版時重跑本腳本即可,平常排程不需要它。

代碼換算(CAP 用 Taiwan_Geocode_103,內政部用 8 碼鄉鎮 / 11 碼村里):
  一般縣市  鄉鎮 1000813      ↔ TOWNCODE 10008130      村里 1000813-012 ↔ VILLCODE 10008130012
  直轄市    鄉鎮 6301100      ↔ TOWNCODE 63000110      村里 6301100-003 ↔ VILLCODE 63000110003

輸出格式:{ 代碼: [lat, lon, 幾何] },幾何為 [多邊形[環[[lat, lon], …]]],可直接交給 L.polygon。
lat/lon 是範圍內部的代表點(polylabel),不是重心,確保落在界內。

執行:uv run --with pyshp --with shapely scripts/build-admin.py
"""
import io
import json
import ssl
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory

import shapefile
from shapely import set_precision
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import polylabel, unary_union

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'data') / 'admin'
DATASETS = {'village': 7438, 'town': 7441}
MUNICIPALITIES = {'63000', '64000', '65000', '66000', '67000', '68000'}
# 簡化容許誤差(度):0.0005 ≈ 50 m,村里界在 zoom 14 仍看不出折損;縣市只當大範圍底,可以更粗
TOLERANCE = {'village': 0.0005, 'town': 0.0005, 'county': 0.001}
PRECISION = 0.0001  # 小數 4 位 ≈ 11 m
UA = {'User-Agent': 'vscbs-admin-builder/1.0'}  # data.gov.tw 對 urllib 預設 UA 回 403


# 政府網站憑證缺 Subject Key Identifier,Python 3.13+ 預設的嚴格模式會拒絕;
# 只關掉這一項,憑證鏈與主機名稱照常驗證
TLS = ssl.create_default_context()
TLS.verify_flags &= ~ssl.VERIFY_X509_STRICT


def get(url: str, timeout: int):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout, context=TLS)


def download(dataset_id: int) -> zipfile.ZipFile:
    api = f'https://data.gov.tw/api/v2/rest/dataset/{dataset_id}'
    meta = json.load(get(api, 60))['result']
    url = next(d['resourceDownloadUrl'] for d in meta['distribution'] if d.get('resourceFormat') == 'SHP')
    parts = urllib.parse.urlsplit(url)
    url = parts._replace(path=urllib.parse.quote(parts.path)).geturl()  # 檔名含中文與括號
    print(f'  下載 {meta["title"]}({meta.get("modifiedDate", "?")})')
    return zipfile.ZipFile(io.BytesIO(get(url, 600).read()))


def read_layers(zf: zipfile.ZipFile, tmp: Path):
    """讀出壓縮檔裡所有 shapefile。主檔之外另有零星補充檔(如瑪家鄉三和村),同代碼的一併合併。"""
    zf.extractall(tmp)
    for shp in sorted(tmp.rglob('*.shp')):
        reader = shapefile.Reader(str(shp.with_suffix('')), encoding='utf-8')
        print(f'    {shp.name}: {len(reader)} 筆')
        yield shp.stem, [(rec.as_dict(), shape(s.__geo_interface__)) for rec, s in zip(reader.records(), reader.shapes())]


def cap_town(towncode: str) -> str:
    county, num = towncode[:5], towncode[5:7]
    return county[:2] + '0' + num + '00' if county in MUNICIPALITIES else towncode[:7]


def compact(geom, tolerance: float):
    """簡化並轉成 Leaflet 的 [[[lat, lon], …], …] 巢狀陣列;簡化到消失的小島直接略過。"""
    g = set_precision(geom.simplify(tolerance, preserve_topology=True), PRECISION)
    polys = [g] if isinstance(g, Polygon) else [p for p in getattr(g, 'geoms', []) if isinstance(p, Polygon)]
    out = []
    for p in polys:
        if p.is_empty or p.area == 0:
            continue
        rings = [p.exterior, *p.interiors]
        # GeoJSON 是 [lon, lat] 且首尾重複;Leaflet 要 [lat, lon]、不需閉合
        out.append([[[round(y, 4), round(x, 4)] for x, y in list(r.coords)[:-1]] for r in rings])
    return out


def label_point(geom):
    largest = max(geom.geoms, key=lambda p: p.area) if isinstance(geom, MultiPolygon) else geom
    pt = polylabel(largest, tolerance=PRECISION)
    return [round(pt.y, 4), round(pt.x, 4)]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    shapes = {'village': defaultdict(list), 'town': defaultdict(list)}
    sources = {}
    county_of = {}

    for level, dataset_id in DATASETS.items():
        with TemporaryDirectory() as tmp:
            for stem, rows in read_layers(download(dataset_id), Path(tmp)):
                sources.setdefault(level, []).append(stem)
                for rec, geom in rows:
                    if level == 'village':
                        if not rec['VILLCODE']:
                            continue
                        code = cap_town(rec['TOWNCODE']) + '-' + rec['VILLCODE'][8:]
                    else:
                        code = cap_town(rec['TOWNCODE'])
                    shapes[level][code].append(geom.buffer(0))  # buffer(0) 修掉自相交
                    county_of[code] = rec['COUNTYCODE']

    files = defaultdict(dict)
    town_geoms = defaultdict(list)
    for level in ('town', 'village'):
        for code, geoms in sorted(shapes[level].items()):
            geom = unary_union(geoms)
            county = county_of[code]
            files[county][code] = [*label_point(geom), compact(geom, TOLERANCE[level])]
            if level == 'town':
                town_geoms[county].append(geom)

    # 縣市層級:由該縣市的鄉鎮聯集而成
    for county, geoms in town_geoms.items():
        geom = unary_union(geoms)
        files[county][county] = [*label_point(geom), compact(geom, TOLERANCE['county'])]

    total = 0
    for county, table in sorted(files.items()):
        body = json.dumps(table, ensure_ascii=False, separators=(',', ':'))
        (OUT / f'{county}.json').write_text(body + '\n')
        total += len(body)
    (OUT / 'meta.json').write_text(json.dumps({
        'sources': {k: sorted(v) for k, v in sources.items()},
        'counts': {'county': len(files), 'town': len(shapes['town']), 'village': len(shapes['village'])},
    }, ensure_ascii=False, indent=2) + '\n')
    print(f'== 完成: {len(files)} 個縣市檔, 鄉鎮 {len(shapes["town"])}, 村里 {len(shapes["village"])}, 共 {total / 1e6:.1f} MB ==')


if __name__ == '__main__':
    main()
