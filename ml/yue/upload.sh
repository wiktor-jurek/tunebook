#!/usr/bin/env bash
# Copies generated YuE2 audio and its requests to the private B2 bucket (credentials from the repo's .env).
# Only generated audio goes here; found YouTube sections stay on our own machines.
#   bash yue/upload.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# Only the B2_ lines: the rest of .env is for Next.js and is not shell syntax.
while IFS='=' read -r name value; do export "$name=$value"; done < <(grep '^B2_' ../.env)
export RCLONE_CONFIG_B2_TYPE=b2 RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID" RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"
copy() { [ -e "$1" ] && rclone copy --transfers 16 --fast-list "$1" "b2:$B2_BUCKET/$2" --exclude '*.download' --exclude '*.m4a' || true; }
# Safari wants audio/mp4; B2 would otherwise guess audio/mp4a-latm from the extension.
web() { [ -e "$1" ] && rclone copy --transfers 16 --fast-list --include '*.m4a' --header-upload 'Content-Type: audio/mp4' "$1" "b2:$B2_BUCKET/$2" || true; }
copy cache/yue/out yue/benchmark
copy cache/yue/homer-out yue/listen
copy cache/yue/listen-out yue/listen
for box in data/yue/train/*/; do copy "$box" "yue/train/$(basename "$box")"; web "$box" "yue/train/$(basename "$box")"; done
for box in cache/yue/refs/vast*/; do copy "$box" "yue/references/$(basename "$box")"; done
web cache/yue/playalong playalong
for requests in cache/yue/train.jsonl cache/yue/train2.jsonl cache/yue/references.jsonl; do copy "$requests" yue/requests; done
rclone size "b2:$B2_BUCKET"
