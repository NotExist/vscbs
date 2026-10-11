#!/usr/bin/env python3
"""把 cbs.tw 的 Atom 來源鏡像到 data/,供同源的純前端頁面讀取。

為什麼用 curl_cffi 而不是 curl:cbs.tw 的 Cloudflare 依 TLS/HTTP2 指紋判斷
是不是瀏覽器。curl 的握手特徵一看就不是,換任何 User-Agent 都會被 403;
curl_cffi 模仿 Chrome 的指紋即可通過,從 GitHub Actions 也一樣。
注意 cbs.tw 也擋 HEAD 請求,一律用 GET。

後備:設了環境變數 FLARESOLVERR_URL(如 http://localhost:8191/v1)時改經 FlareSolverr
取檔。它用真的 Chrome 載入網址,回傳的是 Chrome XML viewer 的 HTML,原文件在其中
一個隱藏 div 裡,取出後是 Chrome 重新序列化的版本:內容相同,但位元組不同
(CDATA 變成跳脫文字、空元素寫法等),因此這條路改用 C14N 判斷內容是否有變。

執行:uv run --with curl_cffi scripts/mirror.py [data]
"""
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
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'data')
ARCHIVE = OUT / 'archive'
TAIPEI = timezone(timedelta(hours=8))
FLARESOLVERR = os.environ.get('FLARESOLVERR_URL')
VIEWER_SOURCE = re.compile(r'<div id="webkit-xml-viewer-source-xml">(.*?)</div><div class="header"', re.S)


def fetch_cffi(name: str) -> bytes:
    r = requests.get(f'{BASE}/{name}', impersonate='chrome', timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f'HTTP {r.status_code}')
    return r.content


def fetch_flaresolverr(name: str) -> bytes:
    body = json.dumps({'cmd': 'request.get', 'url': f'{BASE}/{name}', 'maxTimeout': 90000}).encode()
    req = urllib.request.Request(FLARESOLVERR, data=body, headers={'Content-Type': 'application/json'})
    reply = json.load(urllib.request.urlopen(req, timeout=150))
    sol = reply.get('solution') or {}
    if reply.get('status') != 'ok' or sol.get('status') != 200:
        raise RuntimeError(f"FlareSolverr {reply.get('status')}: {reply.get('message')} / HTTP {sol.get('status')}")
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
            ET.fromstring(content)  # 不是合法 XML(例如 Cloudflare 的擋頁)就當失敗
            return content
        except Exception as e:
            reason = f'{type(e).__name__}: {e}'[:120]
        print(f'  ! {name} 第 {attempt + 1} 次失敗: {reason}', file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    raise SystemExit(f'抓取失敗: {name}')


def canonical(content: bytes) -> str:
    # strip_text 讓 Chrome 重排的縮排空白不算差異;告警文字前後空白本來也無意義
    return ET.canonicalize(content.decode('utf-8'), strip_text=True)


def save_if_changed(content: bytes, dest: Path) -> bool:
    """內容不同才覆寫,回傳是否有變。"""
    if dest.exists():
        old = dest.read_bytes()
        if old == content:
            return False
        # FlareSolverr 取回的是重新序列化的版本,位元組必然不同,改比正規化後的內容
        if FLARESOLVERR and canonical(old) == canonical(content):
            return False
    dest.write_bytes(content)
    return True


def main() -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    print(f"== 取檔方式: {'FlareSolverr(' + FLARESOLVERR + ')' if FLARESOLVERR else 'curl_cffi'} ==")

    print('== 索引與最新告警 ==')
    changed = 0
    for name in ('list.xml', 'rssatomfeed.xml'):
        if save_if_changed(fetch(name), OUT / name):
            changed += 1
            print(f'  ~ {name} 已更新')

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
            {'id': m, 'bytes': (ARCHIVE / f'atom-{m}.xml').stat().st_size}
            for m in months if (ARCHIVE / f'atom-{m}.xml').exists()
        ],
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    print(f'== 完成: 變動 {changed} 個檔案 ==')


if __name__ == '__main__':
    main()
