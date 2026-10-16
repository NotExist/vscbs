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

即時 feed 累積:即時 feed 只保留最近幾天的告警(過期後仍留數天,觀察到 5–9 天),官方月彙整要到次月初才出現。期間每次抓到的
告警依發布月份(台北時間)併入 data/current/atom-YYYYMM.xml(與月彙整同格式,entry 原樣保存),
供歷史回顧先看當月。官方月彙整出現後,先逐筆比對 id 產生對帳報告 data/reconcile/YYYYMM.json
(累積抓到幾成、漏了哪些),再刪除累積檔改用官方版本。每次取得的即時 feed 原檔留在 git 歷史中。

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
CURRENT = OUT / 'current'
RECONCILE = OUT / 'reconcile'
TAIPEI = timezone(timedelta(hours=8))
FLARESOLVERR = os.environ.get('FLARESOLVERR_URL')
ENTRY = re.compile(rb'<entry>.*?</entry>', re.S)
FEED_HEAD = (b'<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" '
             b'xmlns:cap="urn:oasis:names:tc:emergency:cap:1.1" xmlns:georss="http://www.georss.org/georss">\n')
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


def field(entry: bytes, name: str) -> str:
    m = re.search(rb'<' + name.encode() + rb'>([^<]*)</' + name.encode() + rb'>', entry)
    return m.group(1).decode().strip() if m else ''


def month_of(entry: bytes) -> str:
    sent = field(entry, 'sent')
    return datetime.fromisoformat(sent).astimezone(TAIPEI).strftime('%Y%m') if sent else ''


def read_entries(path: Path) -> dict[str, bytes]:
    return {field(e, 'id'): e for e in ENTRY.findall(path.read_bytes())} if path.exists() else {}


def accumulate(feed: bytes, archived: set[str]) -> int:
    """把即時 feed 的告警併入尚未有官方月彙整的月份。已收過的 id 保留第一次的原文,不覆寫。"""
    incoming: dict[str, dict[str, bytes]] = {}
    for e in ENTRY.findall(feed):
        m = month_of(e)
        if m and m not in archived and field(e, 'id'):
            incoming.setdefault(m, {})[field(e, 'id')] = e
    changed = 0
    for m, new in sorted(incoming.items()):
        dest = CURRENT / f'atom-{m}.xml'
        entries = read_entries(dest)
        added = [i for i in new if i not in entries]
        if not added:
            continue
        for i in added:
            entries[i] = new[i]
        ordered = sorted(entries.values(), key=lambda e: field(e, 'sent'), reverse=True)
        body = (FEED_HEAD
                + f'  <id>{m}</id>\n  <title>CBS-ATOM(即時 feed 累積)</title>\n'.encode()
                + f'  <updated>{datetime.now(TAIPEI).isoformat(timespec="seconds")}</updated>\n'.encode()
                + f'  <description type="html"><![CDATA[{m[:4]}年{int(m[4:])}月 即時 feed 累積,官方月彙整發布前的暫存]]></description>\n'.encode()
                + b''.join(b'  ' + e + b'\n' for e in ordered) + b'</feed>\n')
        ET.fromstring(body)  # 確認合併結果仍是合法 XML
        CURRENT.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        changed += 1
        print(f'  ~ current/atom-{m}.xml 新增 {len(added)} 筆(累積 {len(entries)} 筆)')
    return changed


def summary(e: bytes) -> dict:
    sent, expires = field(e, 'sent'), field(e, 'expires')
    hours = None
    if sent and expires:
        hours = round((datetime.fromisoformat(expires) - datetime.fromisoformat(sent)).total_seconds() / 3600, 2)
    return {'id': field(e, 'id'), 'title': field(e, 'title'), 'sent': sent, 'expires': expires,
            'lifetimeHours': hours, 'msgType': field(e, 'msgType'),
            'event': (re.search(rb'<eventCode>\s*<value>([^<]*)</value>', e) or [b'', b''])[1].decode()}


def reconcile(m: str) -> bool:
    """官方月彙整出現後,與累積結果逐筆比對 id,寫出報告並刪除累積檔。"""
    acc_path = CURRENT / f'atom-{m}.xml'
    if not acc_path.exists():
        return False
    acc, arc = read_entries(acc_path), read_entries(ARCHIVE / f'atom-{m}.xml')
    missed = [summary(arc[i]) for i in arc if i not in acc]
    by_event: dict[str, int] = {}
    for x in missed:
        by_event[x['event']] = by_event.get(x['event'], 0) + 1
    report = {
        'month': m,
        'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'archived': len(arc),
        'accumulated': len(acc),
        'matched': len(arc) - len(missed),
        'coverage': round((len(arc) - len(missed)) / len(arc), 4) if arc else None,
        'missedByEvent': dict(sorted(by_event.items(), key=lambda kv: -kv[1])),
        'missed': sorted(missed, key=lambda x: x['sent']),
        'extra': sorted((summary(acc[i]) for i in acc if i not in arc), key=lambda x: x['sent']),
    }
    RECONCILE.mkdir(parents=True, exist_ok=True)
    (RECONCILE / f'{m}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    acc_path.unlink()
    print(f'  ~ 對帳 {m}: 官方 {len(arc)} 筆、累積 {len(acc)} 筆、命中 {report["matched"]} 筆,已刪除累積檔')
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

    # 官方月彙整已出現的月份先對帳、清掉累積檔;其餘月份把即時 feed 併進累積檔
    print('== 即時 feed 累積 ==')
    archived = {m for m in months if (ARCHIVE / f'atom-{m}.xml').exists()}
    for m in sorted(archived & {p.stem[5:] for p in CURRENT.glob('atom-*.xml')}):
        changed += reconcile(m)
    changed += accumulate((OUT / 'rssatomfeed.xml').read_bytes(), archived)

    # 前端用這份 manifest 得知資料更新時間與可回顧的月份。
    # mirroredAt 只在來源真的有變時才更新:每小時排程若都改它,會產生無意義的 commit。
    manifest_path = OUT / 'mirror.json'
    old = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {
        'mirroredAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        if changed or 'mirroredAt' not in old else old['mirroredAt'],
        # entries 供月份選單直接顯示筆數,不必先下載解析該月;partial 表示是即時 feed 累積的暫存
        'months': sorted([
            {'id': m, 'bytes': (ARCHIVE / f'atom-{m}.xml').stat().st_size,
             'entries': (ARCHIVE / f'atom-{m}.xml').read_bytes().count(b'<entry>')}
            for m in months if (ARCHIVE / f'atom-{m}.xml').exists()
        ] + [
            {'id': p.stem[5:], 'bytes': p.stat().st_size, 'entries': p.read_bytes().count(b'<entry>'), 'partial': True}
            for p in CURRENT.glob('atom-*.xml') if p.stem[5:] not in archived
        ], key=lambda x: x['id'], reverse=True),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    print(f'== 完成: 變動 {changed} 個檔案 ==')


if __name__ == '__main__':
    main()
