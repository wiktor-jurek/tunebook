# Listen: tune recognition models

Python side of the Tune finder: a closed-set classifier over every The Session tune, trained on
simulated, FluidSynth-rendered and YuE2 performances and benchmarked on real recordings. Only its
ONNX export reaches the browser; nothing here ships in the web image. (The first approach,
[CLEWS](https://github.com/sony/clews) segment embeddings, is kept in `train/train.py` for the record.)

[PIPELINE.md](PIPELINE.md) explains the whole tune-recognition pipeline: data, features, model, every
training setting, evaluation and the in-browser Tune finder.

## Data

- `npm run`-free export from `apps/web`: `node --max-old-space-size=4096 ../../node_modules/.bin/tsx scripts/export-melodies.ts`
  writes `ml/data/catalog.jsonl.gz` (played-out melody of every setting, via abcjs).
- SoundFonts: GeneralUser GS (its own permissive licence) and MuseScore General (MIT), fetched by `cloud/setup.sh`.

## Benchmarks (real audio)

- `eval/youtube_candidates.py` proposes single-tune YouTube performances, labelled from titles.
  `eval/fetch_youtube.py` caches only each clip's section in `cache/youtube/` (local evaluation only, never committed).
- Labels are checked, trimmed and split in the app's labeller (`/admin/label`), which writes to the data home;
  `store_export.py` regenerates `eval/youtube.csv`, `eval/sessions.csv` and `data/found/manifest.jsonl` from it
  for the tools here (do not edit them by hand). The old local labeller, `eval/review.py`, was retired on
  2026-10-30; the Reels50 map (62 rows unchecked, used only by the old symbolic benchmark) stays a CSV. A clip can be split into several tunes (a set), and tagged with the instruments heard, the number of players and where it was played (pub, stage, studio, home, outdoors).
- `eval/sessions.py` builds the session benchmark, `eval/sessions.csv`: ten whole pub sessions from Portland Irish Music's channel (13th Moon Gravity Well) whose descriptions list every set with its start time. Tune names are matched with `eval/tune_names.py` (titles plus The Session's aliases); the labeller's Sessions tab places the boundaries between tunes and confirms each one. Verified tunes become the `sessions` group in `classifier.py prepare`. `eval/prelabel_sessions.py` runs our finder model, JigRipper and FolkFriend over each recording; the labeller draws one lane per engine and shows, for each tune, how many engines agree. `--resolve` fixes names matched to the wrong namesake when the engines hear the right one, and `--report` summarises agreement.
- `train/classifier.py prepare [--out FILE]` turns every eval clip into features once (`cache/classifier/clips.pt`);
  `train/classifier.py evaluate CHECKPOINT` scores a classifier on them.
- `train/diagnose.py sweep|detail` compares checkpoints: weight blends, sub-centre use, key stability,
  and a holdout of clips that are not in a `--reference` clip file (PIPELINE.md §9).
- `eval/benchmark.py` runs the shipped browser model, [FolkFriend](https://github.com/TomWyllie/folkfriend)
  (its command-line build, in Docker) and JigRipper (its public web model, replayed by a harness kept outside
  the repo; never shipped) over the same clips, whole and as 2–30 s prefixes (`--timing`), and writes
  `apps/web/src/lib/finder/benchmark.json` for the Tune finder → Benchmark page. Engines not rerun keep their answers:
  after a new model ships, `--tunebook --timing` is enough.
- Older engines: `eval/run.py symbolic` (note matching) and `eval/embedding.py` (CLEWS). Their results are in `eval/RESULTS.md`.

## The data home

Labels, tune splits, datasets and runs live in the app's Postgres (schema `ml`, `src/db/ml-schema.ts`);
every source recording lives in the private B2 bucket, YouTube-derived audio included (private storage,
never served or redistributed). PIPELINE.md §13 has the details.

```sh
uv sync --all-groups                                   # the store group: psycopg and boto3 (sync every group, or uv removes the others)
uv run python store_import.py [--yue FILE]            # tune roles and the YuE2 inventory → ml (rerunnable)
uv run python eval/analyse_sources.py                 # music-activity lanes and session set windows for the labeller
```

`ML_DATABASE_URL` (the `ml_writer` role, limited to the `ml` schema) and the `B2_*` keys come from the
repo's `.env`. Label in the app at `/admin/label`; see coverage at `/admin/data` (admins in `ADMIN_EMAILS`).

**The split.** `eval/benchmark_split.json` (now `ml.tune_roles`) fixes which benchmark tunes' real
recordings may be trained on: 283 train, 315 test-only. `classifier.py prepare` evaluates test tunes
only; `classifier.py found-cache` builds `found_train.pt` from album sections of training tunes plus the
training half's labelled YouTube and session clips. A tune listed later follows the same rule.

## Found songs (real training audio)

`python -m found` collects real recordings of catalog tunes straight into the data home (`ml.sources`,
`ml.segments`, `ml.searches`) and the private bucket; nothing stays only on local disk. Each recording is a whole
album track: one `album` source named by its YouTube id, with a segment per labelled stretch and an unnamed
segment for each gap, to name in the labeller.

- `albums` searches YouTube for The Session's album track listings (artist + first tune).
  It accepts a result only when both the artist and the opening tune match. Then it labels
  the first tune from the start of the track and the last tune from its end.
- `titles` searches popular tunes by name and labels them from video titles (lower prior confidence).
- Both also label every tune named in chapters or a timestamped description, and skip
  benchmark videos and tunes, unless given `--include-benchmark`.
- `fetch` downloads each track whole into the bucket. `stats` summarises. `export` writes
  `data/found/manifest.jsonl` from the data home, with each section's split (benchmark tunes are marked).

The first 2,341 recordings were collected as 30 s sections (until 2026-11-06, in `data/found.sqlite`);
`store_tracks.py` turns those into whole tracks.

Labels carry a prior `confidence` by source. `verified` is for manual review.
YouTube audio is for research on our own machines only, never redistributed. Licences are
recorded per video, so a shipped model can be retrained on openly licensed or donated audio alone.

## Rendering

`python -m tunebook_ml.render TUNE_ID out.wav [seed]` renders one performance: tempo and
lilt by tune type, ornaments, variations, 1–3 melody instruments, harmonised backing,
bodhrán, room, noise, phone microphone and codec. Notes are placed by the catalog's `starts`,
so rests stay silent. A 30 s render takes about 0.2 s on one core.

Training doesn't render on the fly. `tunebook_ml/simulate.py` writes the semitone spectrogram
straight from the performance (about 1000× faster) for most of each batch, and
`train/classifier.py render-cache` pre-renders shards of real audio for the rest.

## Training

One image runs everywhere (`cloud/Dockerfile`, PyTorch CUDA 12.8 builds):

```sh
docker build -t tunebook-ml -f cloud/Dockerfile .
docker run --rm --gpus all -v $PWD:/workspace/ml tunebook-ml bash cloud/setup.sh   # SoundFonts (and the old CLEWS weights)
R="docker run --rm --gpus all --shm-size 4g --memory 11g --memory-swap 11g -v $PWD:/workspace/ml -w /workspace/ml -e OMP_NUM_THREADS=1 tunebook-ml"
$R python train/classifier.py yue-cache                                  # YuE2 clips → cache/classifier/yue.pt
$R python train/classifier.py render-cache --workers 8 --prefix rests    # FluidSynth shards → cache/classifier/renders/
$R python train/classifier.py train --name <run> --init <stage-2 checkpoint> ...   # every setting: PIPELINE.md §9
```

Training is a curriculum: 2,000 tunes, then all 23,305 with Partial FC, then a YuE2 fine-tune
with the class head frozen (the default when `--init` has a centre for every tune).
PIPELINE.md §9 has the exact commands and why each setting is what it is.

- **mantis** (home RTX 3070, 8 GB, 15 GB RAM, shared with other services): training, caches and
  evaluation. Cap every container's memory, run **one heavy container at a time**, and check the
  last one has exited before starting another: two 11 GB containers on the 15 GB host
  froze it on 2026-10-29, beyond earlyoom's reach, because neither hit its own cap.
- **Vast.ai** (`cloud/vast.py`): YuE2 generation and anything that needs a bigger GPU. `offers` prints hourly and total cost; nothing
  is rented without `--yes`. The API key lives in the vastai CLI config, never in this repo.

## Tune finder (in the browser)

The Tunes → Tune finder page runs the classifier on the device. The page computes the features
itself (`apps/web/src/lib/finder/features.ts`, a port of `tunebook_ml/pitchclass.py`) and runs an ONNX export
of the model in a web worker with onnxruntime-web, so no audio leaves the device.

```sh
# onnx and onnxruntime are not in the image; install them beside it once
docker run --rm -v $PWD:/workspace/ml -w /workspace/ml tunebook-ml pip install --target scratch/pydeps onnx==1.17.0 onnxruntime==1.20.1
R="docker run --rm --memory 5g -v $PWD:/workspace/ml -w /workspace/ml -e PYTHONPATH=/workspace/ml/scratch/pydeps tunebook-ml"
$R python train/export_finder.py export runs/classifier/<run>/<step>.pt scratch/finder --one-centre   # model.onnx, tunes.json, parity fixture
# the shipped model also takes --sim-centres scratch/prototypes-<run>.pt --sim-parts 8 --dim 192 (diagnose.py prototypes --save; PIPELINE.md §11)
$R python train/export_finder.py quantize scratch/finder --head-bits 4                    # model.int8.onnx; model.int4head.onnx, 36 MB with 8 parts at 192 dimensions
$R python train/export_finder.py check runs/classifier/<run>/<step>.pt scratch/finder --one-centre    # accuracy of each file, answer margin
```

Copy `model.int4head.onnx` (or `model.int8.onnx`) to `apps/web/public/finder/model.onnx`, with `tunes.json` and `popularity.json` beside it
(gitignored), or point `NEXT_PUBLIC_FINDER_MODEL_URL` and `NEXT_PUBLIC_FINDER_TUNES_URL` at hosted copies (`popularity.json` is
fetched from beside `tunes.json`; it holds the finder's popularity prior). Copy
`features.fixture.json` to `apps/web/src/lib/finder/` so `features.test.ts` checks the port against this export.
Browsers cache the model by URL, so bump `CACHE` in `apps/web/src/lib/finder/worker.ts` whenever a new model ships.
