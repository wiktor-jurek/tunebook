# Tune recognition: how the pipeline works

How Tunebook names a tune from a few seconds of audio, end to end: where the training data
comes from, how it is turned into features, the model and every setting it was trained with,
how it is evaluated, and how it runs in the browser. Numbers are as of 2026-10-30.

The short version: a transformer reads 8 s of **pitch-class salience** (which of the 12 notes
are sounding, 50 times a second, rotated to a canonical key) and picks one of **23,305 The
Session tunes**. It learns from three kinds of audio, mixed in every batch: millions of
**simulated** performances made on the fly from the ABC, **FluidSynth renders**, and
**YuE2** performances (an AI music model playing the tune with a band). Real recordings are
mostly kept for evaluation.

```
The Session catalog (55k settings, 23k tunes)
   │  apps/web/scripts/export-melodies.ts (abcjs)
   ▼
data/catalog.jsonl.gz ── played-out melody of every setting: pitches, durations, starts
   │
   ├─► performance.py ── a human-like performance: tempo, swing, ornaments, variations,
   │       │             1-3 melody instruments, key, harmonised backing, bodhrán
   │       ├─► simulate.py ── straight to a semitone spectrogram (no audio), ~1000x faster   ┐
   │       └─► render.py ──── FluidSynth audio + room, noise, phone mic, Opus codec         │
   │                                                                                       │ training
   ├─► yue/events.py → yue/batch.py (Vast GPUs) ── YuE2 band performances, 40,782 clips    │ windows
   │                                                                                       │
   └─► found/ ── real album tracks from YouTube (train-split tunes only)                   ┘
                                                                                           │
audio ─► pitchclass.py: STFT → HPSS → semitones → harmonic salience → 12 pitch classes → KeyCanon
                                                                                           │
                         train/classifier.py: conv stem + 6-layer transformer + sub-center ArcFace
                                                                                           │
                         train/export_finder.py ─► ONNX (int8, 22 MB) ─► browser Tune finder
```

---

## 1. The catalog

`apps/web/scripts/export-melodies.ts` (run from `apps/web`) plays every The Session setting
through abcjs and writes `ml/data/catalog.jsonl.gz`: one row per setting with `tuneId`,
`settingId`, `kind`, `meter`, `mode`, and the played-out melody (repeats expanded) as MIDI
`pitches`, `durations` and `starts` in 1/48 of a whole note.

- **The melody track**: abcjs can emit several tracks. The exporter takes the busiest track
  whose notes carry a `startChar` (the melody), not the busiest track overall, which for 8%
  of settings was the chord-symbol accompaniment (fixed as `MELODY_VERSION` contour-v2).
- **Rests**: `starts` keeps rests and rest pickups (16% of settings have them). Anything that
  turns a melody into time must place notes by `starts`, never by summing durations.
- **Classes**: every tune with at least one non-empty melody, **23,305 tunes**, in sorted
  tune-id order (`catalog_tunes()`). Column *i* of the model is the *i*-th tune id;
  `tunes.json` in the export records the order.
- **Splits** (`tunebook_ml/splits.py`): by tune, `crc32(tune_id) % 100` → 90% train,
  5% valid, 5% test. The classifier has a class for every tune whatever its split; the split
  decides which tunes may have *real* recordings in training (train only) and which are kept
  for evaluation (valid/test, the "bands" set).
- **Popularity**: `data/tune_popularity.csv` (from adactio/TheSession-data) counts member
  tunebooks per tune. It chooses which tunes YuE2 plays and gives an optional re-ranking prior.

## 2. Performances (`tunebook_ml/performance.py`)

`perform(setting, rng, seconds)` turns a setting into the notes a band would play.

| Aspect | What is drawn |
|---|---|
| Tempo | quaver length by tune type, uniform in range. Reel 0.115–0.16 s, jig 0.12–0.165 s, hornpipe 0.13–0.18 s, polka 0.12–0.165 s, slide 0.1–0.135 s, slip jig 0.13–0.17 s, waltz 0.17–0.25 s, others 0.13–0.19 s |
| Swing | first-of-pair lengthening: reel 1.0–1.25, hornpipe 1.3–1.9, barndance 1.3–1.8, strathspey 1.4–2.4, polka 1.0–1.2; jigs get a small, random lilt on the three quavers |
| Timing | notes placed by the catalog's `starts`, so rests and rest pickups stay silent (since 2026-10-29; before, durations were added up back to back) |
| Start | any beat of the tune (the melody is tripled so a late start wraps round) |
| Line-up | 1, 2 or 3 melody instruments (weights 3:2:1) from 13: fiddle (×2 programs), flute, whistle, low whistle, recorder, pipes (adds a drone), accordion, concertina, harmonica, banjo, mandolin, piano |
| Key | half the time a random transposition of −5..+6 semitones, then octaves moved to suit the lead instrument's range |
| Ornaments | cuts and rolls on long notes (35% × the instrument's ornament rate), crans on pipes/flute/low whistle, grace notes on 12% × rate of notes |
| Variation | 3% of notes become a neighbouring scale note, 1.5% are left out (previous note held); slides into notes (6%) on bending instruments |
| Timing | onset jitter 4–15 ms per note; second and third players ±8 ms and detuned (σ 6 cents) |
| Backing | with probability `backing` (0.6): chords harmonised from the melody, voiced and strummed on guitar/bouzouki/piano; bodhrán in 35% of backed performances |

## 3. Simulated spectrograms (`tunebook_ml/simulate.py`)

Rendering audio and running the front end costs ~0.2 s per 30 s clip. Instead, the simulator
writes the **semitone power spectrogram** that `pitchclass.semitones` would measure, directly
from the performance's notes: about 1000× faster, so the 6–11 DataLoader workers make every
training window fresh (no simulated window is ever seen twice).

What it models, per part:
- **Partials 1–6** (0, 12, 19, 24, 28, 31 semitones up) with amplitude ranges by family:
  wind nearly pure, bowed and reeds rich, plucked decaying.
- **Envelopes**: attack 10–50 ms, sustain sag, release 30–80 ms; plucked notes decay
  (0.12–0.5 s). Articulation 60–100% of each note's slot sounds. Per-note level lognormal(0, 0.35).
- **Levels**: lead at 0 dB, other melody players −6–0 dB, backing −12–+4 dB times 0.15–0.8
  (HPSS removes much of a strum), drone −14 to −6 dB, bodhrán as faint broadband clicks.
- **Smear**: bends and vibrato leak into the neighbouring semitone (up to 15% on fiddle,
  flute, low whistle, pipes); bow/breath pressure wobble ±15% per frame.
- **Acoustics**: STFT time smear (7-tap Hann²), room tail in 85% (τ 0.05–0.6 s, 5–40% wet),
  noise in 90% (SNR 3–35 dB, sloped spectrum, slow swells, exponential speckle), phone
  microphone in 70% (±3 dB/octave tilt, high-pass at MIDI 35–62).
- **Rests** (`rests()`): 15% of windows start late (0.3–3 s of silence), 30% have a
  0.2–1.5 s gap in the melody.

`python -m tunebook_ml.simulate 5901 out.png` plots a simulated window above a rendered
one of the same performance.

## 4. Rendered audio (`tunebook_ml/render.py`)

Real audio of the same performances, to cover what the simulator gets wrong. Each part is
rendered by FluidSynth (16 kHz, reverb and chorus off) with a random SoundFont (GeneralUser
GS or MuseScore General), mixed with the same level rules, then `acoustics()`:
room impulse (RT60 0.15–1.2 s), coloured noise (SNR 5–35 dB), phone microphone (high-pass
60–300 Hz, a ±6 dB resonance in 70%, light compression), level 0.3–0.95 of full scale, and an
Opus round trip at 16–48 kbit/s in 30%.

`train/classifier.py render-cache` pre-renders shards: 12 shards × 10,000 windows (**119,999
windows**), each a random setting of a tune chosen so every tune appears equally often.
Stored as float16 pre-KeyCanon features in `cache/classifier/renders/*.pt`. Workers return
NumPy arrays, not tensors: torch hands tensors between processes as file descriptors and runs
out on Linux.

The current shards (`rests-*.pt`, seed 1, 12 workers on mantis, about an hour) are rendered
with the rest timing. The earlier `mac-*.pt` shards, back to back, are kept in
`cache/classifier/renders-old-timing/`. Every model so far trained on those.

## 5. YuE2 performances (`yue/`)

The single biggest improvement. YuE2 is an AI music model that, given a melody as note events
and a text style, plays it with an arranged band: real timbres, ornaments, rooms and
backing that neither the simulator nor FluidSynth produce.

**Requests** (`yue/events.py --train N`): the most popular train-split tunes, **never a
benchmark tune** (any tune in `eval/youtube.csv` at generation time), 2 versions each:
- A random setting with one clean melody line (no `V:` voices, median pitch ≥ 60, ≥ 48 notes).
- Notes barred from the setting's ABC so the pickup lands right, quantised to 1/32, overlaps
  trimmed; up to 128 quarter notes of the tune as written (about 35–45 s).
- Tempo: the tune type's usual pace (reel 220, jig 345 quavers…), × 0.9–1.05, × a pace of
  0.75–1.1; fast tunes are written in halved note values at half tempo (BPM ≤ 180).
- Line-up mix: 60% **sessions** (e.g. "fiddles, flutes and button accordions playing together
  in a pub session") with session backing, 20% **duos**, 20% **soloists**; plus a feel
  ("lively session feel with ornaments", "busy pub session with a crowd", …).
- The style always ends "no vocals, no singing, no choir, no spoken words".
- YuE2 ignores most instrument words: "fiddle" holds, "whistle"/"flute" mostly give a
  whistle, "bouzouki" turns electro-folk, piano never sounds (`yue/describe.py` listens to
  clips with Gemini to check what was played).

**Generation** (`yue/batch.py`, on rented Vast.ai GPUs): the yue2-music instrumental skill's
own score compiler and validation, model loaded once, **8 clips decoded together** (`--batch`),
32 acoustic ODE steps, each clip stopped at 2× its score length + 10 s. Output 16 kHz mono
Opus, pulled to `data/yue/train/<box>/{tune_id}-s{setting}-{n}.ogg`.

**Corpus**: **40,782 clips covering 20,429 tunes** across boxes `vast`, `vast3`, `vast4`,
`w1`–`w4`. `train/classifier.py yue-cache` cuts every clip into 8 s windows every 2 s (**724,432
windows**), stored as uint8 (salience × 255) in `cache/classifier/yue.pt` (~3.5 GB, memory-mapped).

## 6. Found recordings (`found/`)

Real recordings of catalog tunes from YouTube, labelled from The Session's album track
listings (`found albums`: artist + first tune must both match the YouTube "Topic" upload;
the first tune is labelled from the start, the last from the end, chapters label the rest)
and from video titles (`found titles`, less reliable). Benchmark videos and tunes are
skipped. 30 s Opus sections land in `data/found/audio/`, listed in `data/found/manifest.jsonl`
with each section's split.

- **Train-split sections** → `cache/classifier/found_train.pt`: **17,250 windows**, one a
  second. (Built by a one-off script, not yet a `classifier.py` subcommand.)
- **Valid/test sections** → the "bands" eval set; **benchmark-tune sections** → the "albums"
  eval set.

YouTube audio is for research on our own machines only. Licences are recorded per video so a
shipped model can be retrained on openly licensed or donated audio alone.

## 7. Features (`tunebook_ml/pitchclass.py`)

All audio, real or rendered, goes through the same front end; simulated windows join it at
the semitone spectrogram. The browser runs a line-for-line port (`apps/web/src/lib/finder/features.ts`).

| Step | Setting |
|---|---|
| Audio | 16 kHz mono; one window = 8 s = 128,000 samples |
| STFT | n_fft 2048, hop 320 (**50 frames/s**), periodic Hann, centred with reflect padding → 1025 × 401, first 400 frames kept |
| HPSS | median filter 9 frames along time (harmonic) and 17 bins along frequency (percussive); soft mask h² / (h² + p²) |
| Semitones | (spectrum × mask)² through triangular filters ±1 semitone around each MIDI note, rows normalised → 128 × 400 power |
| Level | divide by the 99.5th percentile, `log1p(100 ×)` |
| Salience | for fundamentals **MIDI 55–96 (G3–C7)**: partial 1 × 1.0 + partial 2 (+12) × 0.6 + partial 3 (+19) × 0.4 + partial 4 (+24) × 0.3. Below G3 sit the guitar, bouzouki and bass |
| Fold | octaves added into **12 pitch classes** |
| Drone removal | subtract each pitch class's minimum over the window |
| Normalise | divide by the 99th percentile, clip to [0, 1] |
| **KeyCanon** | rotate the 12 classes so the phase of the pitch-class profile's first Fourier coefficient is 0: any transposition of the same melody gives the same input |

Output: **12 × 400** per window. Cached windows are stored *before* KeyCanon; it is applied
when sampled (and in `export_finder.py`'s model input), so augmentation acts on canonical windows.

## 8. The model (`train/classifier.py`, `Classifier`)

**38.3 M parameters** in training, 26.8 M of them the classifier head (3 centres per tune).
The browser export keeps one centre per tune (`--one-centre`, §11): 20.4 M.

```
(B, 12, 400) KeyCanon'd salience
 → Conv1d 12→128, k5, GELU → Conv1d 128→256, k5, stride 2, GELU → Conv1d 256→384, k3, stride 2
 → 100 tokens × 384 (one per 80 ms), + learned position embedding
 → 6 × TransformerEncoderLayer(d 384, 6 heads, FFN 1536, dropout 0.1, GELU, pre-norm)
 → LayerNorm
 → [attention pooling (Linear → softmax over time) ; mean pooling] → 768
 → Linear 768→384 → L2-normalise = embedding z
 → cosine with 23,305 × 3 sub-centres (normalised), max over each tune's 3 centres
 → (B, 23305) cosines
```

**Sub-center ArcFace** (K = 3 centres per tune): a tune whose settings differ, or that is
played two ways, can occupy more than one region of the embedding space.

**Loss**: ArcFace on the target cosine, cos(θ + m), falling back to CosFace (cos θ − m·sin m)
past π − m; logits × **scale 32**; cross-entropy.

**Partial FC** (`--sample-classes 4096`): each step scores only the batch's own tunes plus
4,096 random others (plus, with `--hard-classes`, each window's 8 closest tunes). A
23k-way softmax from scratch diverges or stalls; a few-thousand-way one trains.

## 9. Training

### Every batch

**256 windows**, of which (for the current model):

| Source | Windows | Rule |
|---|---|---|
| YuE2 (`yue.pt`) | 102 | `--yue-fraction 0.4` |
| Renders | 38 | `--render-fraction 0.15` |
| Found, train split | 18 | `--found-fraction 0.07`, capped by reuse |
| Simulated, made fresh by the loader | 98 | the rest |

Each cached pool's share is capped so a window is drawn about once per `--reuse-steps`
(500) steps: `draws = min(fraction, pool size / (reuse_steps × batch)) × batch`. A small pool
drawn heavily is memorised. Cached windows get **feature-domain augmentation** (`augment()`):

- tempo ±15% (resample along time, crop or pad);
- shift by up to ±1 s (roll);
- 2 time masks of up to 0.6 s;
- drop one pitch class in 25% of windows;
- contrast: salience^γ, γ ∈ [0.7, 1.4];
- a faint second window (× 0.2–0.5, element-wise max) in a third of windows, standing in for backing or another player;
- +3% uniform noise.

### Optimisation

| Setting | Value |
|---|---|
| Optimiser | AdamW, betas (0.9, 0.98), weight decay 0.05 on matrices (not biases, norms or the position embedding) |
| Schedule | linear warm-up over 1,000 steps, then cosine to 0 at `--steps` |
| Precision | bfloat16 autocast; gradient clipping at norm 1.0 |
| Margin ramp | margin × clamp((step − `--margin-start`) / (0.2 × steps), 0, 1) |
| EMA | `--ema 0.999` exponential moving average of the weights; the EMA is what is evaluated and saved |
| Layerdrop | `--layerdrop 0.1`: each encoder layer skipped with p = 0.1 during training |
| Learning rate | 3e-4 trains; 1e-3 diverges at 23k classes |

### How the current model was trained

Three stages, each initialised from the last (`--init`; a smaller run's head is kept for its
tunes, which are the first rows, and the rest start fresh):

| Stage | Run | Tunes | Steps | LR | Margin | Data | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `cur1-2k` | first 2,000 | 8,000 | 3e-4 | 0 | simulated + renders 0.3 + found 0.1 | full softmax; learns the task on an easy problem |
| 2 | `cur2-full` | all 23,305 | 60,000 | 3e-4 | 0.2 from step 20k (ramp 12k steps) | same | Partial FC 4096; no YuE2, no EMA |
| 3 | `diag-e` | all 23,305 | **1,250** of 2,000 | 2e-4 | **0** | sim 98 + YuE2 102 + renders 38 + found 18 | EMA 0.999, layerdrop 0.1, augment, no hard negatives |

Stage 3 command (mantis), as run for diag-e:
```sh
python train/classifier.py train --name diag-e --init runs/classifier/cur2-full/last.pt \
  --steps 2000 --batch 256 --workers 6 --layers 6 --scale 32 --margin 0 --margin-start 0 \
  --render-fraction 0.15 --found-fraction 0.07 --yue-fraction 0.4 --reuse-steps 500 \
  --eval-every 250 --keep --augment 1 --ema 0.999 --layerdrop 0.1 --lr 2e-4 --hard-classes 0
```
About 1,200 windows/s on the RTX 3070; 2,000 steps take about 8 minutes plus evaluations.
The same command today freezes the head (the new default for a fine-tune, §9). With the head
frozen, 2,000–5,000 steps are all about as good; diag-f and diag-g ran 8,000.

### What we learnt about the YuE2 fine-tune

- **It peaks early.** YouTube top-1 climbs 41% → 73% within ~750 steps and holds to ~1,500,
  then falls (60% at 4k, 54% at 8k). At step 1,250 the EMA weights still carry about a third
  of the stage-2 model, so the best model is effectively a blend of the two.
- **The ArcFace margin hurts here.** With it on, the gain is undone: wrong tunes start looking
  similar to real recordings again (diag-a/b: 33–36% at 8k). Without it the decline is slower
  (diag-c: 48% at 8k).
- **Why it declines anyway.** Benchmark tunes have no YuE2 audio by design, so their classes
  are learnt from synthetic audio only. The longer the model adapts to YuE2, the further real
  recordings of those tunes drift from their synthetic-only class centres (cosine to the true
  tune fell 0.207 → 0.165). This is the worst case; in the app 88% of tunes have YuE2 audio.
- Hard negatives (`--hard-classes 8`) were tested inside the failing ft3 run and have not been
  re-tested on their own; they are off.

### Diagnostics (`train/diagnose.py`, 2026-10-29)

Run on `clips-v2.pt` (`prepare --out`). Its 166 YouTube clips that are not in `clips.pt` were
labelled after the step counts were chosen, so they are a **holdout**.

- **No domain split between sub-centres.** In cur2-full and in diag-e 1250 alike, a tune's three
  sub-centres are nearly the same vector (cosine 0.97 to each other). Two-thirds of all centres
  never win for any window. For 98–100% of tunes the same centre wins for simulated, rendered,
  YuE2 and real audio. Through stage 3 every centre stays at cosine ≥ 0.998 to where it started.
  That drift is small, yet freezing the head stops the decline (diag-f, below), so it is the head
  and the backbone moving together that matters.
- **Wrong answers are not biased towards YuE2 tunes.** In diag-e 1250, 80% of wrong winners have
  YuE2 audio, below their 88% share of the catalog (cur2-full: 96%).
- **One centre per tune is as good as three.** Using each tune's mean centre: YouTube 81.2% vs
  80.7%, holdout 77.1% vs 78.3%, bands 54.7% both, albums 62.5% vs 61.5%. The head could be a
  third of its size (about 40 MB → 22 MB int8) for free.
- **KeyCanon jitters, harmlessly.** The rotation changes between 34% of neighbouring windows of
  real clips, nearly always by ±1. Clips with more than 20% changes score about the same as
  the rest (79% vs 81%), and scoring windows at other rotations (key test-time augmentation:
  ±1, ±2, 5/7, all 12) gains nothing.
- **Holdout confirms the stopping point.** Mean-cosine top-1 on the holdout: step 500 74.7%,
  1,000 77.7%, 1,250 78.3%, 1,500 78.3%, 2,000 78.3% (stage 2: 68.1%).
- **WiSE-FT** (weights (1 − α)·cur2-full + α·fine-tuned) never beats the fine-tuned model
  at steps 1,000–2,000. It does rescue a run that went too far: diag-c at 8k goes from 57.9%
  to 74.3% YouTube at α = 0.4.
- **Freezing the head stops the decline** (`--freeze-head`; diag-f is diag-d plus that flag).
  Mean-cosine top-1 from the training log (253 YouTube clips), diag-d → diag-f:

  | Step | 1k | 2k | 4k | 6k | 8k |
  |---|---|---|---|---|---|
  | YouTube | 73.9 → 73.9 | 72.3 → 75.1 | 64.0 → 75.1 | 61.3 → 73.9 | 58.9 → 73.9 |
  | Bands | 54.7 → 54.7 | 53.3 → 53.3 | 41.3 → 53.3 | 36.0 → 50.7 | 36.0 → 49.3 |

  Holdout: step 4,000 78.9% (diag-e 1250: 78.3%). It doesn't raise the peak, but the step
  count stops mattering, which is what longer runs on more YuE2 clips need. `train` now
  freezes the head by default whenever `--init` has a centre for every tune (`--no-freeze-head`
  to override).
- **Rests in the simulator** (diag-g = diag-f with notes placed by `starts`): a tie. Holdout
  78.3 / 77.7 / 77.7 / 76.5% at 2k / 4k / 5k / 8k against diag-f's 78.3 / 78.9 / 78.3 / 76.5%.
  Bands and albums move by a clip or two either way. A fine-tune can't show much: stage 2 learnt
  60k steps without rests, and the render cache (15% of each batch) still has the old timing.

### 2026-10-30: simulated centres, rests, and a leak

**How much the eval can see.** `diagnose.py compare` gives each model's top-1 with a 95% bootstrap
interval and an exact McNemar test against the first model, on the same clips. On 202 YouTube clips
the interval is about ±5 points; 75 bands clips, about ±10. The earlier comparisons (diag-e/f/g,
one centre vs three, steps 1,000–2,000) all differ by one to four clips, p ≥ 0.5: none is a real
difference. Recall@K (YouTube 81 / 85 / 88 / 91% at K = 1 / 5 / 10 / 20) bounds what a re-ranker
can add, and `diagnose.py errors` sorts the wrong answers: half are a different tune type, almost
none are near-duplicate tunes, and most have the truth ranked beyond 50.

**Re-ranking** (`diagnose.py rerank`, top 20, mean cosine, popularity prior × alignment): YouTube
81.2 → 87.1%, albums 62.5 → 74.0%, holdout 77.1 → 80.1%, bands flat. Most of the albums gain is the
popularity prior alone, which the finder could apply in a few lines (`decode.ts`).

**Simulated class centres** (`diagnose.py prototypes`: the mean embedding of 32 simulated windows per
tune, 746k windows, 31 min on mantis). For tunes without YuE2 audio the learnt centre is weak: they
never saw realistic audio. The **hybrid head** keeps the learnt centre for YuE2-seen tunes and uses
the simulated mean for the other 2,876, which include every benchmark tune. Real audio sits closer to
simulated centres than to learnt ones, so those tunes then win too often: on the holdout, seen tunes
fell 80 → 73% while unseen rose 70 → 78%. A cosine offset of 0.03 on the simulated group (`export
--sim-centres FILE --sim-offset 0.03`, built into the ONNX output) balances the two groups (77 / 76%).
Shipped as `apps/web/public/finder/model.onnx` (cache `tune-finder-v3`): int8 YouTube (all 368) 75.1 → 80.4%,
albums 62.5 → 78.1%, bands 54.7 → 53.3%; at the 0.03 margin it answers 84% of clips and is right 90%.
The offset was chosen on the holdout, so its holdout figure flatters it slightly; any offset from 0
to 0.04 gives about the same YouTube and album gains.

**Rests** (notes placed by `starts`, so rests are silent). Stage 2 retrained with them (`cur2r-full`,
60k steps, the cur2-full settings) fits the simulator better (simulated 91% vs 85%) but real audio
no better: YouTube level, albums about 3 points (3 clips) behind at 60k. Its frozen-head YuE2
fine-tune (`ft-r`) ended at YouTube 71.5%, albums 57.3%, bands 49.3%, against diag-g's 74.7 / 61.5 /
53.3% (in-training evaluation, 253 / 96 / 75 clips). Real players rarely leave true silence, so rests
should probably become a decay rather than silence. `diagnose.py compare` on ft-r's step 3,500 (its
final checkpoint was lost, below) runs with the YuE2-from-the-start comparison.

**YuE2 from the start** (`cur2y`: cur2r-full's settings with 30% YuE2 in every batch from step 0, then
the same fine-tune as `ft-y`). Halving the simulator's share lifts the CPU bottleneck: 1,661
windows/s against 815. Results are pending (2026-10-30 evening).

**The leak.** `found_train.pt` was built on 2026-10-26; the YouTube benchmark grew afterwards, and 568
of its 750 "training" album sections turned out to be recordings of 138 tunes that had since become
benchmark tunes, almost all in the holdout. On those clips our model scored 3 points above its clean
average, where FolkFriend's and JigRipper's scores show no such lift: the leak flattered every holdout
number by about 4 points relative to them. The fix is a fixed split by tune
(`eval/benchmark_split.json`, `tunebook_ml/splits.benchmark_tunes()`, now `ml.tune_roles`): 283 tunes
whose real recordings, labelled clips included, may be trained on (the 138 leaked ones plus a fixed
crc32 draw), and 315 kept for testing only. A tune listed later follows the same rule, so no test tune
ever moves. `classifier.py prepare` now evaluates only test tunes, and `classifier.py found-cache`
builds the training pool from album sections plus the training half's YouTube and session clips.

### 2026-10-30/31: YuE2 from the start, clean data, alignment, and per-part centres

The YuE2 comparisons ran on the old clip sets, where only the holdout (166 clips) is clean. The rest
ran on `clips-v3.pt`, test tunes only: YouTube 245, sessions 166, bands 33, albums 181.

**YuE2 from the start: no.** On the holdout, `cur2y` scored 63.9% against cur2r-full's 65.1% at the
end of stage 2. Its frozen-head fine-tune `ft-y` reached 65.7%, against the shipped diag-e's 77.1%
(McNemar p = 0.0003). `ft-r` (rests) came out at 75.9%, level with diag-e (p = 0.69). YuE2 audio
does more good as a fine-tune than mixed in from step 0; rests neither help nor hurt.

**Clean data (`ft-clean`).** This is diag-e's recipe from cur2-full on the clean `found_train.pt`
(1,918 recordings of 513 training-half tunes, 4× the old pool), at 4,000 steps. Every test set came
out level with diag-e: YouTube 79.6 vs 78.8%, albums 64.6 vs 64.1%, bands 45.5 vs 45.5%, all
p ≥ 0.75. So the leak had flattered the old model on the leaked tunes, but had not made it better on
the rest. Note that `--reuse-steps` held the found share to 38 windows a batch (15%).

**Real-to-simulated alignment (`ft-align`): no.** This is `classifier.py --pairs 96`. Every batch of
320 carries 96 found windows and a simulated window of each one's tune. `pair_loss`, an InfoNCE
loss both ways, pulls each real window towards its own tune's simulated windows and away from the
batch's other tunes. The idea was to teach the encoder the step from real to simulated audio for
every tune, not only the 513 that have real audio.

It peaked at step 1,500 (in-training YouTube 71%) and then declined. The pair loss kept falling
(to 1.1): the run memorised 69k windows of 513 tunes, seen about 8 times each, and bent the
embedding away from what serves the other tunes. Final: YouTube 70.2% (p < 0.001 vs diag-e),
albums 56.9% (p = 0.001); per-eighth centres 77.6% against ft-clean's 83.3%.

What the two runs share: more real audio of the same tunes, used gently or hard, does not reach the
test tunes. What is missing is real audio of many more tunes.

**Per-part simulated centres for every tune.** `diagnose.py prototypes` variant (c) takes one
simulated mean per eighth of each tune and scores by the best. On `ft-clean`:

| | learned head | sim mean | sim per eighth | hybrid |
|---|---|---|---|---|
| YouTube | 79.6% | 80.8% | **83.3%** (p = 0.049) | 76.3% |
| Albums | 64.6% | 66.3% | 69.6% (p = 0.06) | 71.3% |
| Bands | 45.5% | 45.5% | 45.5% | 45.5% |
| Sessions | 98.2% | 99.4% | 99.4% | 98.2% |

diag-e gains less from it (YouTube 78.8 → 80.8%). The hybrid head is uneven: it is best on albums,
but falls to 46% on YouTube clips of YuE2-seen tunes. Session clips are near-ceiling for every model,
and not because their players and rooms are familiar: diag-e, which never trained on session audio,
scores 98.8% on them. Several players in unison over whole tunes are simply easy (§9, 2026-10-31).
They are still one band in one room, so they say little about other sessions.

**Shipped 2026-10-31 (cache `tune-finder-v4`), replaced the same day by the 36 MB, 192-dimension finder (§11): ft-clean with eight simulated centres per tune.**
`export --one-centre --sim-centres scratch/prototypes-ft-clean.pt --sim-parts 8`, then `quantize
--head-bits 4`: the head alone goes to 4 bits (`MatMulNBits`, block 32) and the encoder to int8.

| export | size | YouTube | albums | bands |
|---|---|---|---|---|
| torch | | 83.3% | 69.6% | 45.5% |
| int8 | 85 MB | 83.3% | 69.1% | 45.5% |
| int8, 4-bit head | **58 MB** | 83.3% | 69.1% | 45.5% |
| 4 parts, int8, 4-bit head | 36 MB | 81.6% | 66.3% | 45.5% |

The previous finder (diag-e, hybrid head, 22 MB) scores YouTube 78.8%, albums 69.1% on the same
clips. At a top-two margin of 0.03, the new model answers 81.6% of YouTube clips and is right on 95%
of them; the old one answered 84% and was right on 90%. onnxruntime-web 1.20.1 WASM runs
`MatMulNBits` at about 90 ms per window on a Mac, single-threaded, against 55 ms for the old model.
The old file is kept as `apps/web/public/finder/model-diag-e-hybrid.onnx.bak`.

### 2026-10-31: what is left to gain from decoding, and where the errors are

Tests of the shipped model (ft-clean, 8 simulated parts) on `clips-v3.pt`. Each clip's mean cosines were
saved once (`scratch/review-scores-{ft-clean,diag-e,ft-r}.pt` on mantis), and each idea was tuned on
YouTube and then checked on the other sets. Counts are clips gained and lost against the shipped decoding.

| Change | YouTube (245) | Albums (181) | Bands (33) | Sessions (166) |
|---|---|---|---|---|
| shipped: mean cosine | 83.3% | 69.6% | 45.5% | 99.4% |
| **popularity prior**, + 0.006 × ln(tunebooks + 1) | **85.3%** (+5 / −0) | **71.3%** (+3 / −0) | 48.5% (+1 / −0) | 99.4% |
| absolute-key prior (clip key vs written settings) | 84.9% (+4 / −0) | 70.2% (+2 / −1) | 45.5% | 99.4% |
| popularity + key | no better than popularity alone | | | |
| popularity + waltz offset 0.06 | 86.1% (+7 / −0) | 71.8% (+4 / −0) | 48.5% | 99.4% |
| tune-type agreement, windows weighted by margin or best cosine, trimmed mean | no gain, or a loss | | | |
| ensembles of ft-clean, diag-e and ft-r | no gain: they make the same mistakes | | | |

- **Popularity prior.** It gains 9 clips and loses none (p = 0.004 pooled), and at the 0.04 margin the
  finder answers more clips at the same precision: YouTube 80% → 85% answered, 95% → 94% right;
  albums 68% → 75%, 88% → 87%. Any weight from 0.004 to 0.01 does about as well. Now in the finder (§11).
  The benchmark leans towards popular tunes, which flatters it a little.
- **Absolute key.** KeyCanon discards the key, and players mostly use the written one: the clip's
  pitch-class profile phase is within a semitone of its tune's nearest setting for 70% of YouTube clips,
  against 25% of the catalogue. As a prior it helps alone, but the clips it fixes are the ones
  popularity fixes.
- **The ceiling for any re-ranker.** Recall@1 / 2 / 5 / 50: YouTube 83 / 87 / 89 / 91%, albums
  70 / 71 / 75 / 81%. Of 41 wrong YouTube clips, 13 have the truth ranked 2–5, 5 ranked 6–50, 20 beyond
  50, and 3 are tunes with the same name as the label. On albums, 34 of 55 errors rank the truth beyond 50.
  Half of all errors are a representation problem, not a ranking one.
- **Waltzes catch lost clips.** They are 9% of the catalogue but 30% of wrong answers, mostly at low
  confidence (top cosine 0.2 to 0.3). A waltz offset alone changes no answer (the truth is too far down for
  any to become right), but with the prior it adds 2 YouTube clips. A per-tune hubness correction
  (§14) is the principled version.
- **Label errors.** Some confident wrong answers are same-name tunes. For example, "Last Night's Fun" is
  labelled as the reel and the model says the slip jig at cosine 0.78; others are Tommy Peoples', The Pipe
  On The Hob, The Ballydesmond and Toss The Feathers. In the 2026-10-30 benchmark file, all three engines agree on the
  same other tune in 20 of 539 clips, and 8 of those share the label's name. Only 3 of 73 album and band
  errors name another tune of the same track.
- **The first seconds are short of evidence, not spoilt by padding.** From the first t seconds of real
  clips, one window built four ways: zero-padded at the end (the finder), at the start (like the
  simulator's lead-in silence), cropped (the model takes fewer frames), or the audio repeated. YouTube
  top-1 is 17, 29, 39, 43% at 3, 4, 5, 6 s for padding at the end, and the other ways are within a few
  points either side (55% for a full window; 188 clips whose audio is on mantis). Training on short
  windows can't be expected to reach FolkFriend's 44% at 4 s.
- **How fast it locks on, in full windows heard.** First window (8 s) 53% YouTube, 46% albums, 72%
  sessions. At 15 s, 70%, 55% and about 94%; sessions reach about 90% by 13 s. (Beyond the first window
  these are computed over each clip's top 300 tunes, which overstates by a few points.)
- **YuE2 audio of a tune no longer helps that tune.** With simulated centres, YouTube clips of test tunes
  that have YuE2 audio score 76% (63 clips) against 86% for the rest (182). That is not significant, but
  it is not a gain either. The fine-tune helps every tune through the backbone, so YuE2 clips for the
  2,900 uncovered tunes are not worth buying for coverage alone (§14).
- **Paired continuous metrics don't rescue the small sets.** Log-rank of the truth separated
  ft-clean from diag-e no better than McNemar did. The z-scored margin disagreed with top-1, because the
  models' score scales differ. More labelled clips are the only fix.
- **More simulated windows per centre make no measurable difference.** `diagnose.py prototypes --per-tune 128
  --parts 16` (each of the 8 shipped parts averaged about 4 windows; 100 minutes on mantis) scored, without
  the prior, YouTube 84.5% with 16 parts and 84.1% merged to 8, against 83.3% for the shipped centres.
  Albums scored 68.5% against 69.6%, and bands 45.5% against 48.5% (one clip). With the prior, at 8 parts,
  YouTube is 85.3% for both and albums 70.2% against 71.3%. The gain is in the projection below.

### 2026-10-31: how small the head can get (`scratch/review_small.py`)

The head is 23,305 tunes × parts × dimensions, so at 4 bits it is most of the download. The centres and
window embeddings were projected onto the top PCA directions of the centres (no eval data). Projection
is linear, so this is exact for a frozen encoder plus a 384 → d layer. Size = 4-bit head plus 11.5 MB
encoder (the shipped file has about a fifth more overhead). Δ is clips gained minus lost with the prior,
against 384 × 8 parts from the same centres.

| Head | Est. MB | Head MMAC / window | Shipped centres: Δ YouTube / albums | 128-window centres: YouTube / albums (prior), Δ |
|---|---|---|---|---|
| 384 × 8 parts (shipped) | 47.3 | 71.6 | 0 / 0 | 85.3% / 70.2%, 0 / 0 |
| 384 × 16 | 83.1 | 143 | n/a | 85.3% / 72.4%, 0 / +4 |
| 384 × 4 | 29.4 | 35.8 | −4 / −4 | 85.3% / 71.3%, 0 / +2 |
| 256 × 8 | 35.4 | 47.7 | −1 / +1 | 84.9% / 69.6%, −1 / −1 |
| 192 × 8 | 29.4 | 35.8 | −2 / −1 | 85.3% / 69.6%, 0 / −1 |
| 128 × 8 | 23.4 | 23.9 | −9 / −2 | 83.7% / 68.0%, −4 / −4 |
| 128 × 16 | 35.4 | 47.7 | n/a | 84.9% / 69.1%, −1 / −2 |
| 96 × 8 | 20.4 | 17.9 | −10 / −6 | 82.4% / 66.9%, −7 / −6 |
| 64 × 8 | 17.5 | 11.9 | −19 / −11 | 79.6% / 65.7%, −14 / −8 |
| 384 × 8, two stages, K = 200 | 51.8 | 9.6 | −3 / −3 | 83.7% / 69.6%, −4 / −1 |
| 128 × 8, two stages, K = 200 | 24.9 | 3.2 | −13 / −6 | 81.2% / 67.4%, −10 / −5 |

Bands and sessions move by at most one clip in any row.

- **About 30 MB costs nothing measurable.** On the 128-window centres, 192 × 8 and 384 × 4 are both
  29.4 MB and within a clip of the shipped head. That is half the head's work per window. Better-averaged
  centres make the head more robust to cuts: 128 dimensions loses 4 + 4 clips, against 9 + 2.
- **Below 128 dimensions loses clips.** Each halving from 128 down loses 6 to 14 clips.
- **Matryoshka training did not help** (ft-mat, `classifier.py train --matryoshka 128 64`). It used
  ft-clean's recipe from cur2-full, plus ArcFace in the first 128 and 64 dimensions after the space was
  rotated onto the head's PCA axes. Its 384-dimension accuracy tracked ft-clean's. With 32-window centres
  and the prior, it was 1 to 3 clips behind ft-clean at every size: YouTube / albums 81.2% / 69.1% at 128
  dimensions (ft-clean 81.6% / 70.2%), and 76.3% / 63.5% at 64 (77.6% / 65.2%). Two likely reasons. The
  finder projects onto the PCA of its own centres after training, which already picks the best
  directions. And the prefix losses scored against frozen learned centres, whose first 128 dimensions
  cannot move. The untried variant lets the head train under the prefix losses alone. With the encoder
  at a fixed 11.5 MB, 128 / 64 dimensions would save only about 7 / 14 MB on the shipped 36 MB.
- **Two stages cut the work, not the download.** A seventh of the head's work for about 4 YouTube
  clips. It is worth having only if a phone measurement shows the head, not the encoder, is the
  bottleneck.

### 2026-10-31: label fixes (`clips-v4.pt`) and the hubness offset

**Label check.** For each eval error where the model's answer has the label's name, or scores ≥ 0.4,
the clip's pitch classes were aligned (`tunebook_ml.align`) to the ABC of the label and of the answer.
Twenty random tunes of the label's type were aligned as a null, giving a z-score for each. Right labels align at
0.51 / 0.60 / 0.69 (10th / 50th / 90th percentile). A label counts as wrong when it aligns no better than
chance (z < 1.5) and the answer aligns well (z ≥ 2.5). JigRipper's notes in youtube.csv were not used.
Twelve clips qualified:

- **YouTube** (`verified` set to `no`, with a note):
  - Last Night's Fun is the slip jig #5909, not the reel #63.
  - Sonny Brogan's is the mazurka Sonny's #5476.
  - Both Paddy Fahey's rows are labelled as reels for a video titled "(Jig)", and which jig is unknown.
- **Bands and albums** (`eval/found_fixes.csv`, applied by `classifier.py prepare`):
  - Seven album sections and both Eddie Kelly's band sections are another tune of the same track:
    The Meelick Team, Up Sligo, Fanny Power, The Hag's Purse, The Roaring Barmaid, Da Full Rigged Ship,
    and the other Pipe On The Hob.
  - Those tunes are training or benchmark-train tunes, so the sections are dropped.
  - Langstrom's Pony is a benchmark eval tune, so that Kid On The Mountain section is relabelled to it.
- **Left as they are:**
  - Sleepy Maggie aligns with The Man Of The House, but the video is titled Sleepy Maggie, so it needs
    listening.
  - Tommy Peoples', Ballydesmond and Toss The Feathers were inconclusive: the candidates align alike.

`clips-v4.pt` is `clips-v3.pt` with these fixes: YouTube 242, albums 175, bands 31, sessions 166. On it,
the shipped finder (192 dimensions, with the prior) scores YouTube 86.4%, albums 72.6%, bands 48.4% and
sessions 99.4%.

**Hubness offset.** Wrong winners are often tunes that score high against everything (waltzes are 30% of
wrong winners). Each tune's offset is its mean score against the 1,918 real clips of `found_train.pt`
(training tunes only), leaving out its own clips. Decoding becomes mean + prior − β × offset. β and the
form were chosen on YouTube, among the plain mean and the CSLS top-k means for k = 5 to 50:

| Set | Prior only | With offset (mean, β = 1) | Gained / lost |
|---|---|---|---|
| YouTube | 86.4% | 87.6% | +3 / −0 |
| albums | 72.6% | 73.1% | +2 / −1 |
| bands | 48.4% | 51.6% | +1 / −0 |
| sessions | 99.4% | 99.4% | 0 / 0 |

The top-k forms over-correct: β ≥ 0.75 loses clips. The gain is small and not significant (+6 / −1
overall), but it holds outside YouTube and costs nothing at run time. `export_finder.py --hub-reference
cache/classifier/found_train.pt` folds it into the per-tune `offset` that the ONNX graph already
subtracts.

### Earlier runs, for the record

- `pc1`–`pc3`: the full catalog from scratch, diverged or stalled → the curriculum.
- `sweep-*`: LR/scale on 1,000 tunes → 3e-4 with scale 32.
- `ft1`, `ft2`: YuE2 fine-tunes of a 12k-step and then the 60k-step stage 2, on 5k and 8.5k
  clips (YouTube 22% → 32% era).
- `ft3`: 40k steps planned, all 40,782 clips, margin from step 4,000, hard negatives. Peaked
  at step 4,000 (64%) then fell; at step 8,000 its evaluation crashed mantis (see §12).
- `diag-a`…`diag-e`: the diagnostics above. `diag-f`: diag-d with `--freeze-head`. `diag-g`: diag-f with rests.
- `cur2r-full`, `ft-r`: stage 2 and its fine-tune with rests (2026-10-30). `cur2y`, `ft-y`: with YuE2 from the start.
- `ft-clean`: diag-e's recipe on the clean found pool. `ft-align`: the same with `--pairs 96`, 6,000 steps (2026-10-31).

## 10. Evaluation

`train/classifier.py prepare` writes `cache/classifier/clips.pt`: pre-KeyCanon windows of
every eval clip, one window a second, so evaluation during training is just forward passes.

| Set | Clips | What |
|---|---|---|
| `youtube` | 253 | `eval/youtube.csv` rows marked verified or not yet reviewed, with audio cached: single tunes on solo instruments and small groups. 202 verified by ear in the labeller (now `/admin/label`) |
| `bands` | 75 | found recordings of valid/test-split tunes: full bands, albums |
| `albums` | 96 | found album recordings of benchmark tunes |
| `simulated` / `rendered` | 300 each | the same 300 performances, simulated and rendered: the gaps between them show the simulator's and the renderer's shortfall |

**Scoring**: per clip, the cosines of every window are combined two ways: the mean of
softmax(cos × 32 / 1.5) (`top1`) and the plain **mean cosine** (`top1 meancos`, a few points
better, and what the finder uses). Also `top5`, `first8s` (first window only), per-instrument
top-1, `verified top1`, and `yue-seen`/`yue-unseen` (whether the tune had YuE2 audio; only 2
of 253 clips do so far, which the newly labelled candidates will fix).

`evaluate --prior a` multiplies in (tunebooks + 1)^a; `evaluate --rerank` grids the prior
against alignment re-ranking (`tunebook_ml/align.py`). Both helped older models by 7–25
points; they have not been re-measured on the current one.

### The benchmark page (`/tunes/finder/benchmark`, `eval/benchmark.py`)

Tunebook, FolkFriend (open source, its command-line build) and JigRipper (its public web model,
replayed offline; never shipped) on the same clips, each hearing the whole clip. `benchmark.py` writes
`apps/web/src/lib/finder/benchmark.json` (answers and links only). An engine not rerun keeps its earlier
answers, so a new model only needs `--tunebook --timing`. Each scenario names a winner only when
the leader beats the runner-up on the same clips (exact McNemar, p < 0.05). 2026-10-30, hybrid model,
539 clips (before the leak fix):

| Recordings | Tunebook | FolkFriend | JigRipper |
|---|---|---|---|
| YouTube holdout (166) | **76%** | 64% | 70% |
| YouTube (202) | **84%** | 72% | 82% |
| Albums (96) | **78%** | 59% | 66% |
| Bands (75) | 53% | 53% | 56% |

FolkFriend leads on fiddle (90%) and pipes, but not significantly; it fails on banjo (33%). At least
one engine is right on 87% of clips. **Lock-on**: the share named correctly after hearing t seconds
(Tunebook replayed exactly as the finder runs live): FolkFriend is fastest early (42% at 4 s against
our 24%; JigRipper needs 8 s), the lines cross at about 12 s, and Tunebook ends highest (74% at 30 s).
Our first seconds are weak, but not because a window shorter than 8 s is zero-padded: cropping or
padding at the start score the same (§9, 2026-10-31). A few seconds of audio carry too little for this
model. **Popularity**: the benchmark has 133
clips of top-100 tunes, 398 of tunes ranked 101–500, and almost none of rarer tunes.

The page will be rerun on test tunes only (`clips-v3.pt`), about 260 YouTube and album clips plus bands
and the sessions set.

### Current results (same 253 / 75 / 96 clips)

| | stage 2 (`cur2-full`) | current (`diag-e` 1250) | JigRipper |
|---|---|---|---|
| YouTube top-1 (mean cosine) | 47.0% | **75.1%** | 74.7% |
| YouTube verified top-1 | 42.6% | 78.2% | 81.7% |
| YouTube top-5 | 67.6% | 81.0% | 81.8% |
| Bands top-1 | 21.3% | 54.7% | 56.0% |
| Albums top-1 | 35.4% | 61.5% | 65.6% |
| Model size | | 22 MB (int8, one centre per tune; 20M parameters) | 130 MB (fp16, ~65M parameters) |

Caveats: step 1,250 was chosen on these same clips, which flatters it a little; a fixed
schedule should be confirmed on clips the model was never tuned on. And every benchmark tune
was kept out of YuE2, while JigRipper's training data is unknown.

JigRipper (a competitor) is only ever *benchmarked*, in `~/jr-bench` on mantis. Its weights
never ship in Tunebook and its outputs are never used as training labels.

### Cadence (`~/cadence-bench`, 2026-11-05)

Cadence (github.com/Batpapa/Cadence, AGPL-3.0) is a modified FolkFriend in WebAssembly with a Viterbi segmenter for
sessions. `~/cadence-bench/cadence-run.ts` (outside the repo, like JigRipper's harness) replays its `ffWorker.ts`
offline: 48 kHz, the last 10 s every 5 s once 10 s are heard, FolkFriend's published index, the octave fallback, and
Cadence's own `IncrementalViterbiSegmenter`. Benchmark only: its code never ships and its answers are never labels.
`benchmark.py --cadence ~/cadence-bench` scores clips (the final detection covering most of a clip; the truth's rank
follows it among candidates by summed window score; with `--timing`, the newest name shown by each prefix), and
`session_decode.py cadence` scores whole sessions by the decoder replay's rules (a name counts when it first appears,
provisional ones included; one shown during another labelled tune is wrong even if later withdrawn). Commit e1bb6e9:

| Set | Tunebook | Cadence | JigRipper | FolkFriend |
|---|---|---|---|---|
| YouTube (202) | **84.2%** | 79.7% | 81.7% | 72.3% |
| Holdout (166) | **75.9%** | 74.1% | 70.5% | 63.9% |
| Bands (75) | 53.3% | **61.3%** | 56.0% | 53.3% |
| Albums (96) | **78.1%** | 67.7% | 65.6% | 59.4% |

Nothing before 10 s, then 58% of all clips. Sessions (halves a / b): median 10.4 / 10.0 s to name a tune, 83 / 87%
within 15 s, 98.3 / 99.5% found, 5.5 / 2.2 wrong names an hour, against the switch-view decoder's 10.2 / 10.2 s,
81 / 80%, 99.4 / 97.9% and 0.2 / 0.5. Its lead on bands (full ensembles) is the gap to study.

### Tunepal (`eval/tunepal.py`, 2026-10-31)

Tunepal's search is published and open. The author's rebuild, github.com/skooter500/TunepalGodot,
holds the search (`src/tunepal.cpp`), the transcription (`Scripts/record.gd`) and the corpus
(`data/tunepal.db`). Tunepal turns about 10 s of playing into note letters, one per quaver, with sharps
spelt as the natural below. It ranks tunes by the substring edit distance to each tune's stored letters.
`eval/tunepal.py` ports the search exactly, with numba, and searches the thesession.org source of
`tunepal.db`. That source has 12,241 tunes with keys of at least 50 letters, keyed by The Session id, so
it covers 241 of 242 YouTube clips, every album and session clip, and 30 of 31 band clips. The
shipping app's pitch tracker is not in the repo, so there are three front ends, all feeding record.gd's
note segmentation and letter string:

- `prototype`: record.gd's tracker, the loudest bin of a 1024-point FFT. At 48 kHz its 47 Hz bins spell
  D4 as C♯ → "C", so it is a floor.
- `yin strict` and `yin`: a YIN tracker with clean-signal voicing (0.15) or loose voicing (0.5). Loose
  voicing hears all of a solo player but transcribes the backing too. The better of the two in each set
  is Tunepal's method at its best.

The query is the first 10 s of each `clips-v4.pt` clip, as Tunepal records 10 s. The finder is scored
on the same 10 s (its first 3 windows) and on the whole clip, with the prior and without the hubness
offset. Top-1 / top-10:

| Set | Clips | prototype | yin strict | yin | **Finder, 10 s** | Finder, whole clip |
|---|---|---|---|---|---|---|
| YouTube | 241 | 12.0% / 15.4% | 29.9% / 35.3% | 42.7% / 49.8% | **67.2% / 80.1%** | 86.7% / 91.7% |
| albums | 175 | 3.4% / 6.3% | 32.0% / 34.3% | 11.4% / 18.3% | **58.3% / 68.6%** | 72.6% / 80.6% |
| bands | 30 | 3.3% / 10.0% | 20.0% / 20.0% | 10.0% / 10.0% | **43.3% / 50.0%** | 46.7% / 53.3% |
| sessions | 166 | 7.2% / 13.3% | 30.7% / 32.5% | 12.7% / 21.1% | **85.5% / 95.8%** | 99.4% / 100.0% |

On the same 10 s, the finder beats the best Tunepal front end in every set: by 25 points on YouTube,
26 on albums, 23 on bands and 55 on sessions. The method is limited by its letters, not the search. A
synthetic Cooley's from its ABC transcribes almost letter for letter and ranks first. Real accompaniment
and ornaments break the transcription (§1's first engine failed the same way). By YouTube instrument
(loose YIN against the finder at 10 s): flute 62 / 72%, concertina 53 / 69%, accordion 48 / 67%,
whistle 42 / 69%, but banjo 31 / 66% and fiddle 24 / 76%. Solo winds come closest. The real app may do better than these trackers, so the next check
is about 20 clips played into it on a phone.

`tunepal.db` is a benchmark input only: it never ships and is never trained on. The skooter500 repo has
no licence, and the corpus comes from many collections. Download it with the `curl` line in the
script's docstring, to `data/tunepal/` (gitignored).

## 11. In the browser: the Tune finder

Tunes → Tune finder (`/tunes/finder`). Everything runs on the device; no audio is uploaded.

**Export** (`train/export_finder.py`, steps in README):
1. `export --one-centre` replaces each tune's sub-centres with their normalised mean (§9), then
   wraps the model so the class weights are normalised once and the output is each tune's
   cosine, (B, 23305); ONNX opset 17, dynamic batch → `model.onnx` (82 MB; 153 MB with all 3 centres).
   Also writes `tunes.json` (column → tune id) and `features.fixture.json` (the Python
   features of a fixed test signal).
2. `quantize`: dynamic int8 on MatMul/Gemm (onnxruntime has no integer Conv) → 22 MB (40 MB
   with 3 centres). diag-e 1250, one centre, int8: YouTube 75.1%, bands 54.7%, albums 62.5%,
   the same as torch; with 3 centres int8 lost 2 YouTube clips (74.3%).
3. `check`: accuracy of torch and each ONNX file, and how often an answer is right at each
   margin between the top two tunes.

**The shipped finder** (2026-10-31) is ft-clean with simulated part centres from
`diagnose.py prototypes --per-tune 128 --parts 16`, merged to 8 parts and projected onto their top
192 PCA dimensions (`--one-centre --sim-centres scratch/prototypes-ft-clean-128x16.pt --sim-parts 8
--dim 192`, then `quantize --head-bits 4`). The 384 → 192 projection is inside the ONNX graph, so the
browser code is unchanged. Exported 4-bit file, eval clips, without / with the prior:

| Finder | File | YouTube | Albums | Bands |
|---|---|---|---|---|
| 384 dimensions, 32 windows per tune (before) | 58 MB | 83.3% / n/a | 69.1% / n/a | 45.5% |
| 384 dimensions, 128 windows per tune | 58 MB | 84.1% / 85.3% | 68.5% / 70.2% | 45.5% |
| **192 dimensions, 128 windows per tune (shipped)** | **36 MB** | **83.3% / 85.3%** | **68.5% / 69.1%** | **45.5%** |

All within 2 clips (§9, "how small the head can get"). The previous file is kept as
`apps/web/public/finder/model-ft-clean-p8.onnx.bak`, and both exports are on mantis in `scratch/finder-128x16-p8-d*`.

**Since 2026-10-31 evening** (cache `tune-finder-v6`) the same finder also subtracts each tune's hubness offset
(`--hub-reference cache/classifier/found_train.pt`, §9). Exported 4-bit file on `clips-v4.pt` with the prior:
YouTube 87.6%, albums 72.6%, bands 51.6%, against 86.4%, 72.6% and 48.4% before. At the 0.03 margin it answers
85% of YouTube clips and is right on 94% of those. Earlier checkpoints of ft-clean (steps 1500, 2000 and 2500)
were no better than step 4000 under simulated centres. The 192-dimension file without the offset is kept as
`apps/web/public/finder/model-d192.onnx.bak`.

**Runtime** (`apps/web/src/lib/finder/`):
- **Capture**: `getUserMedia` with echo cancellation, noise suppression and auto gain off
  (they are tuned for speech and smear music); an AudioWorklet copies samples into an 8 s ring
  at the device rate.
- **Every second**, the last 8 s go to a web worker (`worker.ts`), which:
  - resamples to 16 kHz (`resample.ts`, 64-tap Blackman sinc, cut-off 7.2 kHz);
  - skips silence (RMS < 0.003);
  - computes features (`features.ts`; `features.test.ts` checks them against the Python output to within 0.002).
    The HPSS median filters keep a sorted window as they slide instead of sorting every position:
    about 40 ms per window on an M-series Mac, down from 180 ms, with bit-identical output.
    Culling FFT bins or doing HPSS after the semitone fold would *not* be equivalent: the level is
    the 99.5th percentile over all 128 semitone rows, and partial 4 of C7 reaches 8.4 kHz;
  - runs the model with onnxruntime-web 1.20.1, single-threaded WASM, loaded from jsDelivr.

  The model is cached with the Cache API after the first download, by URL, in the
  `tune-finder-v6` cache. Bump `CACHE` in `worker.ts` whenever a new model ships; the worker
  deletes older `tune-finder-*` caches.
- **Decoding** (`decode.ts`): the mean cosine of the last **30 windows** (about 37 s of audio), plus a
  **popularity prior** of 0.006 × ln(tunebooks + 1) per tune (§9, 2026-10-31). The counts come from
  `popularity.json`, which `export_finder.py export` writes beside `tunes.json` in the same column order.
  Deploy it with the model: without it the worker warns and ranks by cosine alone. `eval/benchmark.py`
  applies the same prior. The answer is **"Match"** when:
  - at least **3 windows** have been heard;
  - the leader beats the runner-up by **≥ 0.04**;
  - the same tune has led for **2 updates**.

  Otherwise the page shows a "Best guess". The averaging length matters most. Scored through the browser
  code (int8 model) on the 253 YouTube clips (median 83 s long), counting whether the leader is right at
  every second from the third window on:

  | Windows averaged | Right at each second | Right at clip end | Match / right at 0.03 | at 0.04 | at 0.05 |
  |---|---|---|---|---|---|
  | 8 | 59.3% | 53.8% | 62% / 72% | 55% / 78% | 51% / 78% |
  | 16 | 66.7% | 60.5% | 65% / 76% | 58% / 80% | 55% / 81% |
  | 30 (32 measured) | 72.0% | 68.4% | 74% / 83% | 67% / 85% | 63% / 85% |
  | whole clip | 77.1% | 75.5% | 79% / 87% | 73% / 89% | 69% / 89% |

  Longer is better because the eval clips are one tune each; in a real set, 30 windows lets the next
  tune take over in about half a minute. Smoothing across set changes (§14) could get the whole-clip numbers back.
- **Sets**: each new confident tune is added to "Heard this session". `/api/finder` looks up
  names, popularity and whether the tune is already saved.

Model files (`model.onnx`, `tunes.json`, `popularity.json`) live in `apps/web/public/finder/` (gitignored) or wherever `NEXT_PUBLIC_FINDER_MODEL_URL`
and `NEXT_PUBLIC_FINDER_TUNES_URL` point.

## 12. Where it runs

- **mantis** (home server):
  - **Hardware**: RTX 3070 8 GB, 15 GB RAM, 16 cores. It also runs other services.
  - **Data**: the repo's `ml/` is synced to `~/tunebook-ml` and mounted at `/workspace/ml` in the `tunebook-ml` image. `runs/` is root-owned, so logs and scripts go in `~/tunebook-ml/scratch/`.
  - **Memory guard** (`sudo bash ~/mantis-guard.sh`): every Docker container runs in `containers.slice`, capped at 12 GB in total, so the host keeps about 3.5 GB for sshd, Tailscale and the desktop whatever runs. earlyoom (`-m 8 -s 100`, prefers python, protects sshd, docker and tailscaled) kills on low memory alone. The old `-m 5 -s 10` also waited for swap to fill, and the machine thrashed first.
  - **Still cap each container** with `--memory`. Without a cap, ft3's evaluation re-concatenated the 3.5 GB YuE2 pool and hung the machine for seven hours (2026-10-29 morning). `Cached.refresh()` now rebuilds only the renders.
  - **Per-container caps alone are not enough.** On the evening of 2026-10-29 two render-cache containers (11 GB caps, 12 workers), the 3 GB Tune finder end-to-end check and Coolify's 7 GB gpu-worker were allowed 32 GB between them on a 16 GB machine. None hit its own cap, earlyoom never fired, and the host froze until a power cycle. Check `docker ps` before starting another heavy job.
  - **YuE2 runs**: `--yue-stride 2` (default) keeps every second YuE2 window, which overlap by 7 of 8 s: 1.75 GB instead of 3.5 GB. `Cached` holds each pool once (it used to keep the pieces as well as the concatenation; the YuE2 pieces are memory-mapped slices, which stayed mapped): a YuE2-from-the-start run peaks at 6.4 GB, down from 9.0 GB, which had killed `cur2y` and `ft-r` at a checkpoint under 9 GB caps (2026-10-30). Measure a new kind of run with a 300-step `--eval-every 100` test and `docker stats` before queuing it for hours.
  - **Throughput**: the GPU sits at 96–99% while busy, but it waits on the 6 simulator workers about a quarter of the time. More workers would help, but memory is the limit.
- **Vast.ai** (`cloud/vast.py`): YuE2 generation and anything that needs a bigger GPU.
  Nothing is rented without `--yes`; the API key lives in the vastai CLI config, never here.
- **The work Mac**: no training or data jobs.

## 13. The data home (2026-10-30)

Labels, splits, datasets and runs live in the app's Postgres, schema `ml` (`src/db/ml-schema.ts`);
every source recording lives in the private B2 bucket (`ml/audio/...`, `yue/train/...`), YouTube-derived
audio included: private storage, never served or redistributed.

- **Tables**: `sources` (a recording: `youtube_video`, `youtube_full` for whole sessions, `album`, `yue`),
  `segments` (a labelled stretch of a source, in its seconds: tune, set and position, verdict, tags,
  notes, where the label came from), `tune_roles` (train / eval, never moved from eval), `searches`
  (the collector's log), `datasets` and `runs` / `run_evals` (snapshots and run tracking, not yet used).
- **Python**: `tunebook_ml/store.py` (`uv sync --group store`) connects as `ml_writer`, a role limited
  to the `ml` schema (`ML_DATABASE_URL` in the repo's `.env`), and fetches audio from the bucket on
  demand. `store_import.py` imported the CSVs, `found.sqlite` and the YuE2 inventory
  (`yue/inventory.py`, run on mantis); rerunning it changes nothing. `eval/analyse_sources.py`
  adds the labeller's music-activity lanes and cuts each session set's stretch of recording.
- **App**: `/admin/data` (admins in `ADMIN_EMAILS`) shows sources, label status, coverage by popularity
  band, collecting activity and dataset leak checks. `/admin/label` is the labeller, ported from
  `eval/review.py`: album sections, YouTube clips and session sets, with the waveform, music lane,
  engine guesses, trimming and splitting, tune search, tags and keyboard shortcuts, saved straight to
  `ml.segments` (`apps/web/src/lib/labels.ts`). It opens on **Next up** (since 2026-11-04): every queue's
  open items ranked by `rank()` in what most improves the test sets: bands sections, unchecked YouTube
  test clips, YouTube test sets to split, albums sections, session test tunes, then training-only items;
  popular tunes first within each. The bands tunes are `ml.tune_roles` rows with reason "bands set: …"
  (`store_import.py roles()`, from the found manifest's valid/test split).
- **The files are outputs now**: `store_export.py` regenerates `eval/youtube.csv`, `eval/sessions.csv` and
  `data/found/manifest.jsonl` from the data home (cutting again any clip whose times changed in the
  labeller), so the training and evaluation tools read them unchanged. `eval/review.py` is retired.
  Still to switch: the collector (`found/`), `eval/sessions.py`, `youtube_candidates.py`,
  `prelabel_sessions.py` and `fetch_youtube.py`, which write their old files; until then,
  `store_import.py` brings their output in.

## 14. Known gaps and next steps

- **Stopping point:** confirmed on the holdout (§9). With the head frozen (now the default for fine-tunes) it no longer matters much.
- **Rests:** no gain on real audio (§9); try a decay instead of silence, or revert. YuE2 from the start and real-to-simulated pairing are measured dead ends (§9).
- **The first seconds:** padding is not the cause (§9, 2026-10-31), so training on short windows can only help a little. FolkFriend's lead before 12 s comes from note matching, which works on a few notes: an early-answer path that aligns the first seconds against the top candidates' settings (`align.py`) is the idea to test.
- **Real audio of more tunes:** the clean pool's 513 tunes are the binding limit (§9, ft-clean and ft-align). Check the album queue in `/admin/label` and fetch the 442 sections YouTube blocked, then rebuild `found_train.pt`. Rerun the benchmark on test tunes only.
- **A smaller head:** done for 192 dimensions (36 MB, §11). Matryoshka training to go lower did not help (§9).
- **Hard negatives in the fine-tune** (ft-hard, 2026-10-31: ft-clean's recipe with `--hard-classes 8`) did not help.
  With 32-window centres, 8 parts and the prior on `clips-v4.pt`, YouTube / albums / bands were 85.5 / 74.3 / 51.6%,
  against ft-clean's 86.4 / 74.3 / 51.6%. At 192 dimensions they were 84.3 / 73.1 / 51.6% against 85.5 / 73.7 / 51.6%.
- **Octave information helps: the first significant model gain since simulated centres** (2026-11-01, `scratch/octave*.sh`).
  Folding octaves makes a leap up an octave read as a repeated note. `TUNEBOOK_FEATURES=height` adds 12 height
  channels to the front end (`pitchclass.py`): each pitch class's salience-weighted mean semitone, scaled 0.1 to 1
  across G3 to C7, times its salience. KeyCanon turns both groups of 12 together. The height caches are kept apart
  (`classifier.cache_path`: `renders-h/`, `yue-h.pt` built 8 s apart, `found_train-h.pt`, and `clips-v4-h.pt`, which
  holds exactly clips-v4's clips). Renders and found windows are stored as uint8 so the pools fit (§13).
  The whole chain was run again with the same recipes: stage 1 `cur1-h`, stage 2 `cur2-h` (60k), then `ft-h` with
  ft-clean's recipe. The baseline `ft-rc` is the same fine-tune from the 12-channel `cur2r-full`; both use YuE2
  windows 8 s apart. Scored with 32-window simulated centres, 8 parts and the prior, on the same clips:

  | Head | 12 ch: YouTube / albums / bands | 24 ch | Paired, all real clips |
  |---|---|---|---|
  | 384 × 8 | 86.4 / 72.6 / 48.4% | 85.5 / 77.1 / 48.4% | +13 / −7, p 0.26 (albums +9 / −1, p 0.02) |
  | **192 × 8** | 85.1 / 70.3 / 48.4% | **85.5 / 75.4 / 48.4%** | **+14 / −4, p 0.03 (albums +9 / −0, p 0.004)** |
  | 128 × 8 | 80.6 / 70.3 / 45.2% | 84.3 / 74.9 / 48.4% | +25 / −7, p 0.002 |

  Sessions are 99.4% for both. With the learned head the 24-channel model looked worse (YouTube 69.8% against
  74.0%), the same trap as before: judge models by their simulated centres. Height features also shrink better
  (128 dimensions loses 3 YouTube clips, against 14). Training batches were far easier from the start (50% against
  21% top-1 at stage 2 step 4,000), but most of that did not carry over to real audio.
  **Leak check:** `found_train-h.pt` (built 2026-10-31) has 8 album sections of two tunes (1552, 472) that
  `found_train.pt` lacks, and the albums test set holds 8 clips of those tunes. None of the 9 gained album clips is
  one of them, so the gain stands. But the found manifest's splits have moved since `found_train.pt` was built:
  check them before rebuilding either cache.
  **Not shipped: ft-h ties the shipped ft-clean** (2026-11-03, `scratch/hub_sweep.py`, per-clip hits in
  `scratch/sweep-ft-{clean,h}.json` on mantis). Exported as shipped (128-window centres in 8 parts, 192 dimensions,
  prior; `scratch/finder-height`, 36 MB): YouTube / albums / bands 85.1 / 76.0 / 48.4% against ft-clean's
  87.6 / 73.1 / 51.6%, paired +9 / −11 (p 0.82): albums +8 / −3, YouTube +1 / −7. The hubness offset is not the
  cause: without it on both, +9 / −7 (p 0.80), and ft-h barely moves with its weight (0 to 1.5). The +14 / −4 above
  was against ft-rc, whose stage 2 has rests; ft-clean's (`cur2-full`) has none and is ahead of ft-rc by about the
  same margin, so rests seem to cost what height gains. Next: height without rests (or rests as a decay), best
  measured with the quick harness below before another 60k stage 2. `features.ts` (and `listen-core`) compute the
  24 channels behind `CHANNELS` (fixture matches the export's to 1e-5); `CHANNELS` must match the shipped model.
- **Switch the tools to the data home:** the collector, `sessions.py` and the fetchers write to `ml`; build training from frozen `ml.datasets` with leak checks, and record runs in `ml.runs`.
- **Grow the test set where it is thinnest.** Every recipe change since 2026-10-29 has landed inside the error bars. Bands has 33 clips, the 1,200+ album labels are unchecked, and the sessions set is one band in one room. The labeller could confirm labels the engines agree with and queue only the disagreements: that stays unbiased as long as every disagreement is reviewed. Collect rarer tunes too (only 15% of tunes ranked 501–2,000 have any real recording).
- **Same-name labels:** fix the ones in §9 (2026-10-31), and have the labeller warn when a label's title belongs to more than one tune and flag clips where the engines agree on the namesake. These labels also feed `found_train.pt`.
- **Covering the rest of the catalogue with YuE2 is not supported** by the 2026-10-31 measurement: with simulated centres, a tune's own YuE2 audio does not help its real recordings. If more YuE2 is bought, buy variety (line-ups and feels it renders well) for any tunes, and measure it as a fine-tune first.
- **Better simulated centres:** they beat the learned head, and finer parts beat coarser ones. Next: more windows per part (running, §9), cleaner or noisier simulation for the centres, and then the symbolic prototypes below.
- **Hubness correction:** subtract from each tune's cosine the mean of its top-k cosines over a background of real or YuE2 windows of other tunes (CSLS). It is the principled form of the waltz offset and the old 0.03 simulated-centre offset.
- **A quick test harness (`train/quick.py`, built 2026-11-03):** runs use the same 2,500 tunes
  (`cache/classifier/quick-tunes.json`: the 562 eval-clip tunes, the 513 with found audio, a seeded random fill)
  and score the real clips as the finder does (32-window simulated centres in 8 parts plus the prior) against those
  tunes only; `quick.py compare` gives paired McNemar tests. **Warm starts only** (`--init`): from scratch, the
  12-channel model sits on a plateau (5k steps: 6% simulated top-1, 0% on real clips; cur1-2k was the same, 8% at
  8k), so a from-scratch run cannot rank ideas. Each run continues `cur2-full` (or `cur2-h` for height) for 4k steps
  with the head trained, its rows mapped by tune id (`classifier.py --tune-set` with `--init`). 600 steps already
  score 85.5 / 75.4 / 51.6%. About 30 minutes a run on mantis (700 windows/s with 8 workers, 5 GB). Switches:
  `TUNEBOOK_FEATURES=height`, and `TUNEBOOK_RESTS=0` (notes back to back, in `classifier.Simulated.settings`, so
  training and centres both follow it). Renders keep the timing they were built with, so runs use
  `--render-fraction 0` unless renders are the question. Size changes (width, layers, stride) cannot warm start
  from these backbones. First batch: `scratch/quick2.sh` (log `quick2.log`). Only paired differences on the same
  tune set count.
  **First batch (2026-11-04, `scratch/quick2.log`): stable but insensitive.** Scored with sim centres + prior
  (YouTube / albums / bands, 242 / 175 / 31 clips), base is 87.6 / 77.7 / 54.8%. Seeds differ by +4/−4 and +2/−2
  clips, and no change moved the sim-centre score beyond that: no rests +4/−7, renders 0.3 +4/−5, no YuE2 +4/−7,
  no found audio +7/−9, margin 0 +6/−10, backing 0.3 / 0.9 +4/−5 / +5/−4, 8k steps +6/−6 (all p ≥ 0.45). Height
  from `cur2-h` against base is +11/−10, and rests make no difference with height either (+6/−7). The learned head
  is noisier (seeds +2/−9, +5/−8) but moved with the data: no YuE2 −17/+3 (p 0.003), no found audio **+17/−2**
  (p 0.001: the 513-tune found pool pulls the head towards its tunes). So 4k steps of continued training cannot
  change what simulated centres see; the backbone decides. Rests and height are settled as no gain at the shipped
  metric. Recipe tweaks look exhausted: the remaining levers are structural (the input from scratch, symbolic
  prototypes, decoding) and a bigger test set. To test the input or a smaller model, train from scratch where it
  learns fast (24 channels: cur1-h was at 34% simulated top-1 by 4k steps), or distil a small student from ft-clean.
  **From scratch (2026-11-04, `scratch/quick3.sh`, log `quick3.log`): 12k steps is far too short to rank ideas.**
  Runs from scratch on the 2,500 tunes, 12k steps (80 minutes each), no renders. Sim centres + prior, YouTube /
  albums / bands: `s-h` (24 ch, 6 × 384) 59.1 / 52.6 / 41.9%, its seed 1 62.4 / 52.6 / 35.5%, `s-h-small`
  (4 × 256, heads 4) 52.1 / 41.1 / 25.8%, `s-12` (12 ch) 62.0 / 52.0 / 38.7%, against the warm-started base's
  87.6 / 77.7 / 54.8%. Every run was still climbing steeply at 12k (simulated top-1 0.29 → 0.64 → 0.71 at 6k / 9k /
  12k for `s-h`; YouTube top-1 by the learned head 2 → 14 → 19%). Seeds alone differ by +28/−22 clips (sim) and
  +55/−21 (head, p < 0.001), so from-scratch runs this short only show large effects. **The 12-channel plateau did
  not appear here:** `s-12` kept pace with `s-h` at every evaluation (sim +22/−27 for height, p 0.57), so height
  gives no gain from scratch either, and the plateau seen in cur1-2k and the 5k-step quick smoke is not a property
  of 12 channels on this tune set. The smaller model is clearly behind at equal steps (+11/−53, p < 0.001), but it
  may only be slower. To compare sizes or inputs from scratch, runs need to be near convergence (30k+ steps, about
  3.5 hours each on mantis) with two seeds an arm.
  **Model size from scratch (2026-11-05, `scratch/quick4.sh`, log `quick4.log`): the smaller model loses.** 30k steps,
  12 channels, two seeds an arm; real-clip accuracy levelled off by 20k. 6 × 384 scored 80.6 / 70.9 / 51.6% and
  79.3 / 68.0 / 48.4% (YouTube / albums / bands, sim centres + prior); 4 × 256 scored 78.9 / 65.7 / 45.2% and
  78.9 / 64.0 / 41.9%. All four cross pairs favour the larger model (+12/−27, +6/−25, +14/−20, +12/−22), while its
  seeds differ by +10/−19; the learned head drops about 10 points. Shrinking costs 3–4 points, mostly albums and bands,
  so a bigger model (rented GPU) is the direction to test, not a smaller one. From scratch on 2,500 tunes stays about
  7 points under the warm-started base (87.6 / 77.7 / 54.8%).
- **Session mode on whole recordings: done (2026-11-05, `eval/session_decode.py`).** The shipped model runs once
  along each session video (one 8 s window a second, top 256 tunes kept, `cache/decode/`; 10 videos, 11.3 hours, two
  minutes each on mantis), and the decoder and the setlist rule of `use-listener.ts` are replayed against the checked
  sets. Shipped (30 windows): every tune named, but a median 19.6 / 19.2 s after it starts (halves a / b, 177 / 188
  tunes) and only 11% within 15 s; 0.2 / 0.5 wrong names an hour. A shorter history alone is fast but flips (10
  windows: 10 s, 5 wrong an hour) and gives more wrong first answers on single clips (`session_decode.py clips`: 8
  windows, YouTube 20 → 24%, albums 23 → 28%, bands 32 → 42% of clips). **Shipped instead: a switch view**
  (`SWITCH_WINDOW` 8, `SWITCH_MARGIN` = 0.04 + 0.06 in `decode.ts` and `listen-core`): once a tune is named, the mean
  of the last 8 windows watches for another tune leading by 0.10 for 2 updates, which is then named and the history
  cut to those 8. Median 10.2 / 10.2 s, 48 / 46% within 10 s and 81 / 80% within 15 s, wrong names unchanged at
  0.2 / 0.5 an hour, one tune per half more never named; single clips unchanged (the first answer uses the long
  history). Not tried yet: The Session's set transitions (`data/sets.csv`, `data/transitions.json`) as a prior on
  the next tune, and Cadence's Viterbi segmenter (below).
- **A floor on the leader's score: shipped (2026-11-06, `MIN_SCORE` 0.35 in `decode.ts` and `listen-core`).** Nothing is
  named while the leader's score (mean cosine plus prior) is under 0.35, however far ahead it is. From Cadence's author,
  who replayed the 4 November finder on his hand-labelled pub sessions (sung parts and bar noise included): 95.6% of
  tunes found against Cadence's 93.3%, but 17% of names wrong against 5%, and names given on pure bar noise. Most
  wrong names sat at low scores, the repeat offenders chromatic "hub" tunes (Flight of the Bumblebee #8426, Chromatic
  #23777); a 0.35 floor brought him to about 5% wrong and nothing on noise, at 94.4% found. On our session videos
  (`session_decode.py compare --variant '{"floor": 0.35}'`) wrong names are already rare (0.6 / 1.6% of names, halves
  a / b) and the floor changes little: with the switch view, nothing at all up to 0.40; without it, one tune of 177
  fewer found on half a and a few named a second later. These videos are clean (the model gets 99% of their clips), so
  they hold none of the noise the floor is for, and only 0.7 h falls outside their labelled tunes. On two phone
  recordings from a pub (5 November, web front end and branch decoder) the floor removed every name that looked wrong:
  Chromatic at a score of 0.24 on a 3-minute set, and the first of three names in 24 s of one tune (#11003, 0.35 →
  kept #17264 and #23477). 0.40 named nothing on either, so it is too high for phone audio. Still to measure: what the
  floor costs on noisy recordings with labels (label a few pub sessions, or ask Cadence's author to replay his set).
- **Bigger model:** JigRipper has about 1.7× our parameters (9 × 768 transformer layers against our 6 × 384), and a model that large needs a rented GPU. Also raise the low end of the range to G4, as JigRipper does; that needs a full feature rebuild.
- **More real audio:** use album tracks with weak labels (multiple-instance learning). `found_train.pt` is now built by `classifier.py found-cache`.
- **Popularity prior:** in the finder since 2026-10-31 (§11). Measured without gain: key test-time augmentation, an absolute-key prior on top of it, tune-type agreement, window weighting and model ensembles (§9). Re-test hard negatives on their own.
- **Ideas from an outside review, not tried yet:**
  - **Symbolic prototypes:** compute each tune's class centre from its ABC with a small encoder trained jointly with the audio encoder, instead of learning 23k free vectors. It would drop most of the head, give tunes without YuE2 audio centres that move with the rest, and let new The Session tunes be added without retraining. The most promising of the bigger changes.
  - **Richer input with the G4 rebuild:** a few octave-band channels so the direction of leaps survives the fold, an onset channel, a stem convolution that wraps round the 12 pitch classes, rotary position embeddings, and pooling over 4 segments to keep phrase order. All need the caches rebuilt, so do them in one go with the G4 change.
  - **Matryoshka head:** train with the loss also applied to 64/128/256-dim prefixes of the embedding, for a smaller head at export. With one centre at d = 128 the int8 model would be about 15 MB (the backbone alone is about 11.5 MB).
  - Not worth doing: culling FFT bins or running HPSS after the semitone fold (not equivalent, §11), and pairing sim and YuE2 windows by bar (YuE2 windows are not bar-aligned).
- **Finder:**
  - Self-host onnxruntime-web and the model for production.
  - Try a 4-bit head (`MatMulNBits` via onnxruntime's `matmul_4bits_quantizer`, the head's MatMul only): about 22 → 16 MB if accuracy and the 0.03 match margin hold, and if onnxruntime-web's WASM build runs the op.
  - Measure per-window time on phones (40 ms per window on a Mac since the sliding median).
  - Smooth the answer across set changes, as in JigRipper's Markov decoder. The Session's sets data gives which tunes follow which.
