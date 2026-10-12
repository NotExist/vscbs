#!/usr/bin/env python3
"""把 cbs.tw 的 Atom 來源與告警類型說明鏡像到 data/,供同源的純前端頁面讀取。

為什麼用 curl_cffi 而不是 curl:cbs.tw 的 Cloudflare 依 TLS/HTTP2 指紋判斷
是不是瀏覽器。curl 的握手特徵一看就不是,換任何 User-Agent 都會被 403;
curl_cffi 模仿 Chrome 的指紋即可通過,從 GitHub Actions 也一樣。
注意 cbs.tw 也擋 HEAD 請求,一律用 GET。

後備:設了環境變數 FLARESOLVERR_URL(如 http://localhost:8191/v1)時改經 FlareSolverr
取檔。它用真的 Chrome 載入網址,回傳的是 Chrome XML viewer 的 HTML,原文件在其中
一個隱藏 div 裡,取出後是 Chrome 重新序列化的版本:內容相同,但位元組不同
(CDATA 變成跳脫文字、空元素寫法等),因此這條路改用 C14N 判斷內容是否有變。
JSON 則是在 Chrome JSON viewer 的 <pre> 裡,同理改比解析後的內容。

執行:uv run --with curl_cffi scripts/mirror.py [data]
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

from curl_cffi import requests

BASE = 'https://cbs.tw/files'
# 官方的告警類型說明(名稱、發布機關、發布條件、應變建議),前端據此標示事件類型
ALERT_TYPES_URL = 'https://cbs.tw/public/upload/files/json/alertTypesList.json'
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'data')
ARCHIVE = OUT / 'archive'
TAIPEI = timezone(timedelta(hours=8))
FLARESOLVERR = os.environ.get('FLARESOLVERR_URL')
VIEWER_SOURCE = re.compile(r'<div id="webkit-xml-viewer-source-xml">(.*?)</div><div class="header"', re.S)
JSON_VIEWER = re.compile(r'<pre[^>]*>(.*?)</pre>', re.S)


def url_of(name: str) -> str:
    return name if name.startswith('https://') else f'{BASE}/{name}'


def is_json(name: str) -> bool:
    return name.endswith('.json')


def fetch_cffi(name: str) -> bytes:
    r = requests.get(url_of(name), impersonate='chrome', timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}')
    return r.content


def fetch_flaresolverr(name: str) -> bytes:
    body = json.dumps({'cmd': 'request.get', 'url': url_of(name), 'maxTimeout': 90000}).encode()
    req = urllib.request.Request(FLARESOLVERR, data=body, headers={'Content-Type': 'application/json'})
    reply = json.load(urllib.request.urlopen(req, timeout=150))
    sol = reply.get('solution') or {}
    if reply.get('status') != 'ok' or sol.get('status') != 200:
        raise RuntimeError(f"FlareSolverr {reply.get('status')}: {reply.get('message')} / HTTP {sol.get('status')}")
    if is_json(name):
        m = JSON_VIEWER.search(sol.get('response') or '')
        if not m:
            raise RuntimeError('回應裡找不到 JSON viewer 的 <pre> 區塊')
        return html.unescape(m.group(1)).encode()
    m = VIEWER_SOURCE.search(sol.get('response') or '')
    if not m:
        raise RuntimeError('回應裡找不到 XML viewer 的原文件區塊')
    # 取出的是 HTML 序列化結果:&nbsp; 在 XML 裡不合法,換成數字參照
    xml = m.group(1).replace('&nbsp;', '&#160;')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n' + xml).encode()


def fetch(name: str) -> bytes:
    get = fetch_flaresolverr if FLARESOLVERR else fetch_cffi
    for attempt in range(3):
        try:
            content = get(name)
            # 不是合法 XML/JSON(例如 Cloudflare 的擋頁)就當失敗
            if is_json(name):
                if not isinstance(json.loads(content).get('data'), list):
                    raise ValueError('JSON 缺少 data 陣列')
            else:
                ET.fromstring(content)
            return content
        except Exception as e:
            reason = f'{type(e).__name__}: {e}'[:120]
        print(f'  ! {name} 第 {attempt + 1} 次失敗: {reason}', file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    raise SystemExit(f'抓取失敗: {name}')


def canonical(content: bytes, as_json: bool = False) -> str:
    if as_json:
        return json.dumps(json.loads(content), ensure_ascii=False, sort_keys=True)
    # strip_text 讓 Chrome 重排的縮排空白不算差異;告警文字前後空白本來也無意義
    return ET.canonicalize(content.decode('utf-8'), strip_text=True)


def save_if_changed(content: bytes, dest: Path) -> bool:
    """內容不同才覆寫,回傳是否有變。"""
    if dest.exists():
        old = dest.read_bytes()
        if old == content:
            return False
        # FlareSolverr 取回的是重新序列化的版本,位元組必然不同,改比正規化後的內容
        as_json = dest.suffix == '.json'
        if FLARESOLVERR and canonical(old, as_json) == canonical(content, as_json):
            return False
    dest.write_bytes(content)
    return True


def main() -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    print(f"== 取檔方式: {'FlareSolverr(' + FLARESOLVERR + ')' if FLARESOLVERR else 'curl_cffi'} ==")

    print('== 索引、最新告警、告警類型說明 ==')
    changed = 0
    for name in ('list.xml', 'rssatomfeed.xml'):
        if save_if_changed(fetch(name), OUT / name):
            changed += 1
            print(f'  ~ {name} 已更新')

    # 檔名不帶來源的路徑:data/ 下只有這一個 JSON 來源,與 places.json 等自產檔並列
    if save_if_changed(fetch(ALERT_TYPES_URL), OUT / 'alert-types.json'):
        changed += 1
        print('  ~ alert-types.json 已更新')

    # 索引裡的月份 id 就是 YYYYMM,檔名固定為 atom-<id>.xml
    months = sorted(set(re.findall(rb'<id>(\d{6})</id>', (OUT / 'list.xml').read_bytes())), reverse=True)
    months = [m.decode() for m in months]
    if not months:
        raise SystemExit('list.xml 沒有解析出任何月份')

    # 當月與上月的彙整仍可能變動,每次都重抓;其餘只補缺漏。
    now = datetime.now(TAIPEI)
    recent = {now.strftime('%Y%m'), (now.replace(day=1) - timedelta(days=1)).strftime('%Y%m')}

    print(f'== 月彙整 (共 {len(months)} 個月, 重抓 {"/".join(sorted(recent))}) ==')
    for m in months:
        dest = ARCHIVE / f'atom-{m}.xml'
        if dest.exists() and m not in recent:
            continue
        if save_if_changed(fetch(f'atom-{m}.xml'), dest):
            changed += 1
            print(f'  ~ atom-{m}.xml ({dest.stat().st_size} bytes)')

    # 前端用這份 manifest 得知資料更新時間與可回顧的月份。
    # mirroredAt 只在來源真的有變時才更新:每小時排程若都改它,會產生無意義的 commit。
    manifest_path = OUT / 'mirror.json'
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {
        'mirroredAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        if changed or 'mirroredAt' not in old else old['mirroredAt'],
        'months': [
            # entries 供月份選單直接顯示筆數,不必先下載解析該月
            {'id': m, 'bytes': (ARCHIVE / f'atom-{m}.xml').stat().st_size,
             'entries': (ARCHIVE / f'atom-{m}.xml').read_bytes().count(b'<entry>')}
            for m in months if (ARCHIVE / f'atom-{m}.xml').exists()
        ],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    print(f'== 完成: 變動 {changed} 個檔案 ==')


if __name__ == '__main__':
    main()
