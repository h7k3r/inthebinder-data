#!/usr/bin/env bash
# Weekly copy of the data branch, and the way back (16 Nov 2026).
#
# The data branch is one commit, replaced on every run. Most of it is rebuilt
# from scratch each day, but three things are not: the Pokemon price history
# (one point a week; the Cardmarket EUR points exist nowhere else), the card
# map (ids looked up a few thousand at a time) and the "Hot today" snapshot.
# If a run ever started without the previous data (a failed fetch) it would
# publish a branch without them and the next run would carry on from that.
#
#   tools/data_snapshot.sh save <out dir>
#       After publishing: if the newest snapshot is SNAPSHOT_EVERY_DAYS (6)
#       or more days old, upload <out dir> (without *.db) as the asset of a
#       release data-snapshot-YYYYMMDD and keep the SNAPSHOT_KEEP (8) newest.
#       Refuses a folder with under 80% of the last snapshot's files or no
#       price history, so a broken day cannot replace a good copy.
#   tools/data_snapshot.sh restore <out dir>
#       Before building: an empty <out dir> gets the whole newest snapshot;
#       otherwise only what is missing of the three things above.
#
# Needs gh (GH_TOKEN) in the repository. Prints ::warning:: lines for Actions.
set -euo pipefail
cmd=${1:?usage: data_snapshot.sh save|restore <out dir>}
out=${2:?usage: data_snapshot.sh save|restore <out dir>}
PREFIX=data-snapshot-
ASSET=data-snapshot.tar.gz
KEEP=${SNAPSHOT_KEEP:-8}
EVERY=${SNAPSHOT_EVERY_DAYS:-6}
PRECIOUS=(pokemon/history pokemon/_map.json pokemon/_hot_snapshot.json)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Snapshot tags, newest first.
snapshots() {
  gh release list --limit 100 --json tagName,createdAt \
    --jq "[.[] | select(.tagName | startswith(\"$PREFIX\"))] | sort_by(.createdAt) | reverse | .[] | \"\(.tagName) \(.createdAt)\""
}

# (The publish step leaves out/.git behind; it is not data.)
count_files() { find "$1" -type f ! -name '*.db' ! -path "$1/.git/*" | wc -l | tr -d ' '; }

case "$cmd" in
  save)
    [ -d "$out/pokemon/history" ] || { echo "::warning::snapshot not saved: $out has no pokemon/history"; exit 0; }
    newest=$(snapshots | head -n 1 || true)
    files=$(count_files "$out")
    history=$(find "$out/pokemon/history" -type f | wc -l | tr -d ' ')
    if [ -n "$newest" ]; then
      tag=${newest%% *}; at=${newest#* }
      age=$(( ( $(date -u +%s) - $(date -u -d "$at" +%s) ) / 86400 ))
      if [ "$age" -lt "$EVERY" ]; then echo "snapshot: $tag is $age days old, nothing to do"; exit 0; fi
      before=$(gh release view "$tag" --json body --jq '.body' | sed -n 's/.*files=\([0-9]*\).*/\1/p' | head -n 1)
      if [ -n "$before" ] && [ $(( files * 100 )) -lt $(( before * 80 )) ]; then
        echo "::warning::snapshot not saved: $files files today against $before in $tag (under 80%) - look at today's run"
        exit 0
      fi
    fi
    tag="$PREFIX$(date -u +%Y%m%d)"
    tar -czf "$work/$ASSET" --exclude='*.db' --exclude='./.git' -C "$out" .
    gh release delete "$tag" --yes --cleanup-tag 2>/dev/null || true
    gh release create "$tag" "$work/$ASSET" --latest=false \
      --title "Data snapshot $(date -u +%Y-%m-%d)" \
      --notes "Copy of the data branch for putting it back (tools/data_snapshot.sh restore). files=$files history=$history"
    echo "snapshot: $tag saved ($files files, $history history files, $(du -h "$work/$ASSET" | cut -f1))"
    snapshots | tail -n +$(( KEEP + 1 )) | while read -r old _; do gh release delete "$old" --yes --cleanup-tag; done
    ;;
  restore)
    mkdir -p "$out"
    missing=()
    if [ -z "$(ls -A "$out")" ]; then missing=(.)
    else for p in "${PRECIOUS[@]}"; do [ -e "$out/$p" ] || missing+=("$p"); done; fi
    [ ${#missing[@]} -gt 0 ] || { echo "restore: nothing missing"; exit 0; }
    newest=$(snapshots | head -n 1 || true)
    [ -n "$newest" ] || { echo "restore: missing ${missing[*]} and no snapshot to take it from"; exit 0; }
    tag=${newest%% *}
    gh release download "$tag" --pattern "$ASSET" --dir "$work"
    if [ "${missing[0]}" = . ]; then
      tar -xzf "$work/$ASSET" -C "$out"
      echo "::warning::the previous data could not be read; started from snapshot $tag instead"
    else
      for p in "${missing[@]}"; do
        if tar -xzf "$work/$ASSET" -C "$out" "./$p" 2>/dev/null; then
          echo "::warning::$p was missing; put back from snapshot $tag"
        else
          echo "restore: $p is not in $tag either"
        fi
      done
    fi
    ;;
  *) echo "usage: data_snapshot.sh save|restore <out dir>" >&2; exit 2 ;;
esac
