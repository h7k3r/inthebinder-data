#!/usr/bin/env bash
# Checks tools/data_snapshot.sh against a stand-in for gh that keeps its
# "releases" in a folder (needs jq, as gh's own --jq does).
#   bash tools/test_data_snapshot.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export STATE="$T/releases"; mkdir -p "$STATE" "$T/bin"
cat > "$T/bin/gh" <<'GH'
#!/usr/bin/env bash
# release list|view|create|delete|download, enough for data_snapshot.sh
[ "$1" = release ] || exit 3
sub=$2; shift 2
case "$sub" in
  list)
    jqx=; while [ $# -gt 0 ]; do case "$1" in --jq) jqx=$2; shift 2;; *) shift;; esac; done
    arr='[]'
    for d in "$STATE"/*/; do [ -d "$d" ] || continue
      arr=$(jq -c --arg t "$(basename "$d")" --arg c "$(cat "$d/createdAt")" '. + [{tagName:$t, createdAt:$c}]' <<<"$arr")
    done
    jq -r "$jqx" <<<"$arr" ;;
  view) cat "$STATE/$1/body" ;;
  create)
    tag=$1; file=$2; shift 2; notes=
    while [ $# -gt 0 ]; do case "$1" in --notes) notes=$2; shift 2;; *) shift;; esac; done
    mkdir -p "$STATE/$tag"; cp "$file" "$STATE/$tag/"; printf '%s' "$notes" > "$STATE/$tag/body"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE/$tag/createdAt"; echo "$tag" >> "$STATE/../created.log" ;;
  delete) [ -d "$STATE/$1" ] || exit 1; rm -rf "${STATE:?}/$1" ;;
  download)
    tag=$1; shift; pat=; dir=.
    while [ $# -gt 0 ]; do case "$1" in --pattern) pat=$2; shift 2;; --dir) dir=$2; shift 2;; *) shift;; esac; done
    cp "$STATE/$tag/$pat" "$dir/"; echo "$tag" >> "$STATE/../downloads.log" ;;
esac
GH
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH"
S="$here/data_snapshot.sh"
fails=0; n=0
ok() { n=$((n+1)); if eval "$2"; then echo "ok  $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
old() { # a snapshot made $2 days ago with $3 files
  mkdir -p "$STATE/$1"; date -u -d "-$2 days" +%Y-%m-%dT%H:%M:%SZ > "$STATE/$1/createdAt"
  printf 'Copy of the data branch. files=%s history=1' "$3" > "$STATE/$1/body"
  tar -czf "$STATE/$1/data-snapshot.tar.gz" -C "$T/good" .
}
mkout() { rm -rf "$1"; mkdir -p "$1/pokemon/history" "$1/web"
  for i in $(seq 1 "$2"); do echo "{\"p\":$i}" > "$1/web/f$i.json"; done
  echo '{"me06":[1]}' > "$1/pokemon/history/me06.json"; echo '{"a":1}' > "$1/pokemon/_map.json"
  echo '{}' > "$1/pokemon/_hot_snapshot.json"; echo '[]' > "$1/games.json"; echo db > "$1/pokemon.db"
  mkdir -p "$1/.git/objects"; echo x > "$1/.git/HEAD"; echo x > "$1/.git/objects/ab"; }
today="data-snapshot-$(date -u +%Y%m%d)"
mkout "$T/good" 20

# save
out=$(bash "$S" save "$T/good" 2>&1)
ok "first save makes today's snapshot" '[ -f "$STATE/$today/data-snapshot.tar.gz" ]'
ok "it records the file count (24, no .db)" 'grep -q "files=24 history=1" "$STATE/$today/body"'
ok "the .db file is left out" '! tar -tzf "$STATE/$today/data-snapshot.tar.gz" | grep -q "\.db$"'
ok "so is out/.git (left by the publish step)" '! tar -tzf "$STATE/$today/data-snapshot.tar.gz" | grep -q "\.git/"'
out=$(bash "$S" save "$T/good" 2>&1)
ok "a second save the same day does nothing" 'grep -q "nothing to do" <<<"$out"'
rm -rf "${STATE:?}"/*
for i in $(seq 1 10); do old "data-snapshot-2026010$i" $((70 - i)) 24; done
out=$(bash "$S" save "$T/good" 2>&1)
ok "an old snapshot means a new one" '[ -d "$STATE/$today" ]'
ok "only the 8 newest are kept" '[ "$(ls "$STATE" | wc -l)" -eq 8 ]'
ok "the three oldest went" '[ ! -d "$STATE/data-snapshot-20260101" ] && [ ! -d "$STATE/data-snapshot-20260102" ] && [ ! -d "$STATE/data-snapshot-20260103" ] && [ -d "$STATE/data-snapshot-20260104" ]'
rm -rf "${STATE:?}"/*; old data-snapshot-20260101 9 100
out=$(bash "$S" save "$T/good" 2>&1)
ok "under 80% of last snapshot's files: refused" 'grep -q "under 80%" <<<"$out" && [ ! -d "$STATE/$today" ]'
mkout "$T/nohist" 30; rm -rf "$T/nohist/pokemon/history"
out=$(bash "$S" save "$T/nohist" 2>&1)
ok "no price history: refused" 'grep -q "no pokemon/history" <<<"$out" && [ ! -d "$STATE/$today" ]'

# restore
rm -rf "${STATE:?}"/*; old data-snapshot-20260101 3 24
mkdir -p "$T/empty"; out=$(bash "$S" restore "$T/empty" 2>&1)
ok "empty folder: the whole snapshot" '[ -f "$T/empty/web/f20.json" ] && [ -f "$T/empty/pokemon/history/me06.json" ] && [ -f "$T/empty/games.json" ]'
ok "and says so" 'grep -q "::warning::the previous data could not be read" <<<"$out"'
mkout "$T/part" 5; rm -rf "$T/part/pokemon/history" "$T/part/pokemon/_map.json"; echo '{"today":1}' > "$T/part/web/f1.json"
out=$(bash "$S" restore "$T/part" 2>&1)
ok "missing history and map come back" '[ -f "$T/part/pokemon/history/me06.json" ] && grep -q "\"a\"" "$T/part/pokemon/_map.json"'
ok "nothing else is touched" 'grep -q today "$T/part/web/f1.json" && [ ! -f "$T/part/web/f20.json" ]'
ok "each one is named" '[ "$(grep -c "put back from snapshot" <<<"$out")" -eq 2 ]'
rm -f "$T/downloads.log"; mkout "$T/full" 5
out=$(bash "$S" restore "$T/full" 2>&1)
ok "nothing missing: nothing downloaded" 'grep -q "nothing missing" <<<"$out" && [ ! -f "$T/downloads.log" ]'
rm -rf "${STATE:?}"/*; rm -rf "$T/e2"; mkdir -p "$T/e2"
out=$(bash "$S" restore "$T/e2" 2>&1); code=$?
ok "no snapshot yet: carries on (first run)" '[ $code -eq 0 ] && grep -q "no snapshot" <<<"$out"'

echo "$((n - fails))/$n passed"
[ "$fails" -eq 0 ]
