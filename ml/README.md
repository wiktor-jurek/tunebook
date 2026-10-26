# Listen: tune recognition models

Python side of Listen: synthetic session performances rendered from The Session
catalog, fine-tuning [CLEWS](https://github.com/sony/clews) segment embeddings on them,
and benchmarks against real recordings. Nothing here ships in the web image.

## Data

- `npm run`-free export from the repo root: `node --max-old-space-size=4096 node_modules/.bin/tsx scripts/export-melodies.ts`
  writes `ml/data/catalog.jsonl.gz` (played-out melody of every setting, via abcjs).
- SoundFonts: GeneralUser GS (its own permissive licence) and MuseScore General (MIT), fetched by `cloud/setup.sh`.

## Benchmarks (real audio)

- `eval/youtube_candidates.py` proposes single-tune YouTube performances, labelled from titles.
  `eval/fetch_youtube.py` caches only each clip's section in `cache/youtube/` (local evaluation only, never committed).
- `eval/review.py` serves a page at http://127.0.0.1:8765 to verify labels and the Reels50 mapping.
- `eval/run.py symbolic` scores the existing note-matching engine; `eval/embedding.py` scores an embedding checkpoint.
- Results go in `eval/RESULTS.md`.

## Found songs (real training audio)

`python -m found` collects real recordings of catalog tunes into `data/found.sqlite`, with
the labelled 30 s sections as Opus files in `data/found/audio/` (neither is committed):

- `albums` searches YouTube for The Session's album track listings (artist + first tune).
  It accepts a result only when both the artist and the opening tune match. Then it labels
  the first tune from the start of the track and the last tune from its end.
- `titles` searches popular tunes by name and labels them from video titles (lower prior confidence).
- Both also label every tune named in chapters or a timestamped description, and skip
  benchmark videos and tunes, unless given `--include-benchmark`.
- `fetch` downloads only the labelled sections. `stats` summarises. `export` writes
  `data/found/manifest.jsonl` with each section's split (benchmark tunes are marked).

Labels carry a prior `confidence` by source. `verified` is for manual review.
YouTube audio is for research on our own machines only, never redistributed. Licences are
recorded per video, so a shipped model can be retrained on openly licensed or donated audio alone.

## Rendering

`python -m tunebook_ml.render TUNE_ID out.wav [seed]` renders one performance: tempo and
lilt by tune type, ornaments, variations, 1–3 melody instruments, harmonised backing,
bodhrán, room, noise, phone microphone and codec. A 30 s render takes about 0.2 s on one
core, so training renders on the fly instead of storing a corpus.

## Training

One image runs everywhere (`cloud/Dockerfile`, PyTorch CUDA 12.8 builds):

```sh
docker build -t tunebook-ml -f cloud/Dockerfile .
docker run --rm --gpus all -v $PWD:/workspace/ml tunebook-ml bash cloud/setup.sh   # SoundFonts, CLEWS, DiscogsVI weights
docker run -d --gpus all --shm-size 4g -v $PWD:/workspace/ml -w /workspace/ml/cache/clews tunebook-ml \
  python ../../train/train.py jobname=ft1 conf=../../train/tunebook-clews.yaml init_weights=../checkpoints/dvi-clews/checkpoint_best.ckpt
```

- **mantis** (home RTX 3070, 8 GB, 15 GB RAM, shared with other services): smoke tests, evaluation
  and the small on-device student. Cap containers (`--memory 10g --cpus 10`) and keep batches small.
- **Vast.ai** (`cloud/vast.py`): full fine-tunes. `offers` prints hourly and total cost; nothing
  is rented without `--yes`. The API key lives in the vastai CLI config, never in this repo.
