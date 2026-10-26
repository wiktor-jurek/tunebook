#!/usr/bin/env bash
# Prepares a rented 24 GB GPU for YuE2: the instrumental skill, its pinned runtime and weights.
set -euo pipefail
mkdir -p /workspace/yue && cd /workspace/yue
if [ ! -d skill ]; then
  apt-get update -qq && apt-get install -y -qq ffmpeg git > /dev/null
  git clone -q --depth 1 https://github.com/multimodal-art-projection/YuE.git repo
  cp -r repo/skills/yue2-music/instrumental skill
fi
cd skill
[ -x .venv/bin/python ] || python3 scripts/setup_runtime.py install --venv .venv
[ -d models/YuE2-3B ] || .venv/bin/python scripts/setup_runtime.py models --output models
# The doctor wants an idle GPU, so it runs once; later runs may share the card with a batch.
[ -f .doctor-passed ] || { .venv/bin/python scripts/setup_runtime.py doctor --require-gpu --models-root models && touch .doctor-passed; }
