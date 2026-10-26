#!/usr/bin/env bash
# Prepares /workspace/ml on a GPU box: the tunebook-ml container, or a fresh Vast.ai image.
set -euo pipefail
cd /workspace/ml

# The tunebook-ml image (cloud/Dockerfile) already has these; a bare CUDA box does not.
if ! command -v fluidsynth > /dev/null; then
  apt-get update -qq
  apt-get install -y -qq fluidsynth libfluidsynth3 ffmpeg git rsync > /dev/null
fi
command -v uv > /dev/null || curl -LsSf https://astral.sh/uv/0.8.11/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv sync --group train

mkdir -p cache/soundfonts cache/checkpoints
[ -d cache/clews ] || git clone -q --depth 1 https://github.com/sony/clews.git cache/clews
[ -f cache/soundfonts/GeneralUser-GS.sf2 ] || curl -sL -o cache/soundfonts/GeneralUser-GS.sf2 https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2
[ -f cache/soundfonts/MuseScore_General.sf2 ] || curl -sL -o cache/soundfonts/MuseScore_General.sf2 https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2
# Only the DiscogsVI checkpoint, read out of the 8.7 GB Zenodo archive with range requests.
[ -f cache/checkpoints/dvi-clews/checkpoint_best.ckpt ] || uv run --with remotezip python -c "
from remotezip import RemoteZip
with RemoteZip('https://zenodo.org/records/15045900/files/clews.zip?download=1') as z:
    for name in ('dvi-clews/configuration.yaml', 'dvi-clews/checkpoint_best.ckpt'):
        z.extract(name, 'cache/checkpoints')
"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
echo "Ready: $(nproc) CPU cores"
