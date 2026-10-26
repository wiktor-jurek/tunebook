#!/usr/bin/env bash
# Copies generated YuE2 audio and its requests to the private B2 bucket (credentials from the repo's .env).
# Only generated audio goes here; found YouTube sections stay on our own machines.
#   bash yue/upload.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# Only the B2_ lines: the rest of .env is for Next.js and is not shell syntax.
while IFS='=' read -r name value; do export "$name=$value"; done < <(grep '^B2_' ../.env)
export RCLONE_CONFIG_B2_TYPE=b2 RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID" RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"
copy() { [ -e "$1" ] && rclone copy --transfers 16 --fast-list "$1" "b2:$B2_BUCKET/$2" --exclude '*.download' || true; }
copy cache/yue/out yue/benchmark
copy cache/yue/homer-out yue/listen
copy cache/yue/listen-out yue/listen
for box in data/yue/train/*/; do copy "$box" "yue/train/$(basename "$box")"; done
copy data/yue/references yue/references
# Safari wants audio/mp4; B2 would otherwise guess audio/mp4a-latm from the extension.
[ -d cache/yue/playalong ] && rclone copy --transfers 16 --include '*.m4a' --header-upload 'Content-Type: audio/mp4' cache/yue/playalong "b2:$B2_BUCKET/playalong"
for requests in cache/yue/train.jsonl cache/yue/references.jsonl; do copy "$requests" yue/requests; done
rclone size "b2:$B2_BUCKET"
