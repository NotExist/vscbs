#!/usr/bin/env bash
# 把 cbs.tw 的 Atom 來源鏡像到 data/，供同源的純前端頁面讀取。
# cbs.tw 不回 CORS 標頭，瀏覽器無法直連，因此鏡像是必要的一步。
set -euo pipefail

BASE="https://cbs.tw/files"
OUT="${1:-data}"
ARCHIVE="$OUT/archive"
CURL=(curl -fsS --retry 3 --retry-delay 2 --max-time 120 -A "vscbs-mirror (+https://github.com)")
changed=0

mkdir -p "$ARCHIVE"

# 抓到暫存檔，內容不同才覆蓋，藉此判斷是否需要重寫 cache。
fetch_if_changed() {
  local url="$1" dest="$2" tmp
  tmp="$(mktemp)"
  if ! "${CURL[@]}" -o "$tmp" "$url"; then
    echo "  ! 抓取失敗: $url" >&2
    rm -f "$tmp"
    return 1
  fi
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$dest"
  chmod 644 "$dest"
  return 0
}

echo "== 索引與最新告警 =="
fetch_if_changed "$BASE/list.xml" "$OUT/list.xml" && echo "  ~ list.xml 已更新" || true
fetch_if_changed "$BASE/rssatomfeed.xml" "$OUT/rssatomfeed.xml" && echo "  ~ rssatomfeed.xml 已更新" || true

# 索引裡的月份 id 就是 YYYYMM,檔名固定為 atom-<id>.xml
months="$(grep -oE '<id>[0-9]{6}</id>' "$OUT/list.xml" | tr -dc '0-9\n' | sort -r)"
[ -n "$months" ] || { echo "list.xml 沒有解析出任何月份" >&2; exit 1; }

# 當月與上月的彙整仍在增長,每次都重抓;其餘只補缺漏。
now="$(TZ=Asia/Taipei date +%Y%m)"
prev="$(TZ=Asia/Taipei date -d "$(TZ=Asia/Taipei date +%Y-%m-01) -1 month" +%Y%m)"

echo "== 月彙整 (共 $(echo "$months" | wc -l) 個月, 重抓 $now / $prev) =="
for m in $months; do
  dest="$ARCHIVE/atom-$m.xml"
  if [ -f "$dest" ] && [ "$m" != "$now" ] && [ "$m" != "$prev" ]; then
    continue
  fi
  if fetch_if_changed "$BASE/atom-$m.xml" "$dest"; then
    changed=1
    echo "  ~ atom-$m.xml ($(wc -c <"$dest") bytes)"
  fi
done

# 前端用這份 manifest 得知鏡像時間與可回顧的月份,不必再解析 list.xml 的外部 URL。
{
  printf '{\n  "mirroredAt": "%s",\n  "months": [' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  sep=""
  for m in $months; do
    [ -f "$ARCHIVE/atom-$m.xml" ] || continue
    printf '%s\n    {"id": "%s", "bytes": %s}' "$sep" "$m" "$(wc -c <"$ARCHIVE/atom-$m.xml")"
    sep=","
  done
  printf '\n  ]\n}\n'
} > "$OUT/mirror.json"

echo "== 完成: $(du -sh "$OUT" | cut -f1), 月彙整變動=$changed 個 =="
