#!/usr/bin/env python3
"""把 cbs.tw 的 Atom 來源鏡像到 data/,供同源的純前端頁面讀取。

為什麼用 curl_cffi 而不是 curl:cbs.tw 的 Cloudflare 依 TLS/HTTP2 指紋判斷
是不是瀏覽器。curl 的握手特徵一看就不是,換任何 User-Agent 都會被 403;
curl_cffi 模仿 Chrome 的指紋即可通過,從 GitHub Actions 也一樣。
注意 cbs.tw 也擋 HEAD 請求,一律用 GET。

執行:uv run --with curl_cffi scripts/mirror.py [data]
"""
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from curl_cffi import requests

BASE = 'https://cbs.tw/files'
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'data')
ARCHIVE = OUT / 'archive'
TAIPEI = timezone(timedelta(hours=8))


def fetch(name: str) -> bytes:
    for attempt in range(3):
        try:
            r = requests.get(f'{BASE}/{name}', impersonate='chrome', timeout=120)
            if r.status_code == 200 and r.content.lstrip().startswith(b'<?xml'):
                return r.content
            reason = f'HTTP {r.status_code}'
        except requests.RequestsError as e:
            reason = type(e).__name__
        print(f'  ! {name} 第 {attempt + 1} 次失敗: {reason}', file=sys.stderr)
        time.sleep(2 * (attempt + 1))
    raise SystemExit(f'抓取失敗: {name}')


def save_if_changed(content: bytes, dest: Path) -> bool:
    """內容不同才覆寫,回傳是否有變。"""
    if dest.exists() and dest.read_bytes() == content:
        return False
    dest.write_bytes(content)
    return True


def main() -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)

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
