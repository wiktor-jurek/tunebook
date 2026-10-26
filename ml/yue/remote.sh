#!/usr/bin/env bash
# Runs on a rented 24 GB GPU: installs YuE2's instrumental workflow and renders every request.
#   bash remote.sh requests/ out/
set -uo pipefail
REQUESTS=$(realpath "$1"); OUT=$(realpath -m "$2")
bash "$(dirname "$0")/setup.sh" || exit 2
mkdir -p "$OUT"
cd /workspace/yue/skill

for request in "$REQUESTS"/*/; do
  name=$(basename "$request")
  [ -f "$OUT/$name.flac" ] && continue
  rm -rf "work/$name"
  start=$(date +%s)
  .venv/bin/python scripts/instrumental.py run --composer agent --events "$request/events.json" \
    --style-file "$request/style.txt" --models-root models --offline --output "work/$name" > "work-$name.log" 2>&1
  status=$?
  audio=$(find "work/$name" -name audio.flac | head -1)
  if [ -n "$audio" ]; then
    cp "$audio" "$OUT/$name.flac"
    echo "$name ok status=$status $(( $(date +%s) - start ))s"
  else
    echo "$name failed status=$status: $(tail -3 "work-$name.log" | tr '\n' ' ')"
  fi
done
echo done
