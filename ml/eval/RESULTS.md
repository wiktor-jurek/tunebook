# Listen benchmark results

Real-world YouTube clips (`eval/youtube.csv`), 15 s sections streamed in 1 s chunks.
Labels marked *unverified* come from video titles and include some mistakes.

| Date | Engine | Labels | n | top-1 @10 s | top-5 @10 s | top-1 @15 s | confident | false-confident | median s |
|---|---|---|---|---|---|---|---|---|---|
| 2026-10-25 | symbolic (YIN + landmark hashing + alignment) | unverified | 192 | 24.5% | 27.1% | 28.1% | 18.2% | 0.5% | 7 |

Symbolic baseline by instrument (top-1 @10 s): flute 54%, tin whistle 40%, accordion 39%,
concertina 25%, banjo 13%, session 9%, fiddle 8%, uilleann pipes 8%. It works on clean,
pure-toned wind instruments and fails on bowed strings, drones and ensembles, which is
the gap the learned engine has to close.

## Embedding models (eval/embedding.py)

Candidates are the 192 labelled tunes plus random distractor tunes, each with 2 rendered
reference performances, so these numbers are not yet comparable to the full-catalog
symbolic row above; a full-catalog run follows once a model is worth indexing.

| Date | Model | Labels | candidates | top-1 @5 s | top-1 @10 s | top-5 @10 s | top-1 @15 s |
|---|---|---|---|---|---|---|---|
| 2026-10-25 | CLEWS DiscogsVI, zero-shot | unverified | 392 | 13.0% | 15.6% | 27.1% | 15.6% |

### Reference audio: YuE2 performances vs FluidSynth renders (2026-10-26)

The same CLEWS DiscogsVI checkpoint (zero-shot) and the same real clips, with the candidate
tunes limited to the 29 benchmark tunes that have both a clip and YuE2 references (2 per
tune, `yue/events.py` → `yue/remote.sh`). Only the reference audio changes. This is a small
set with an easy 29-way choice, so it compares reference kinds and is not a headline number.

| References | n | top-1 @5 s | top-1 @10 s | top-5 @10 s | top-1 @15 s |
|---|---|---|---|---|---|
| FluidSynth renders | 29 | 27.6% | 20.7% | 44.8% | 37.9% |
| YuE2 performances | 29 | 41.4% | 62.1% | 79.3% | 72.4% |

### Band recordings and the first three-source fine-tune (2026-10-26)

*Bands* are found album recordings (`python -m found`) of valid- and test-split tunes, which
training never sees. There are 75 sections of 24 tunes, with 949 candidates. *YouTube* is
`eval/youtube.csv` with `--all` (rejected labels excluded): 124 clips, 324 candidates.
References are renders in both.

| Date | Model | Bands top-1 @10 s | Bands top-5 @10 s | YouTube top-1 @10 s | YouTube top-5 @10 s |
|---|---|---|---|---|---|
| 2026-10-26 | CLEWS DiscogsVI, zero-shot | 8.0% | 17.3% | 16.1% | 25.0% |
| 2026-10-26 | smoke3: 3 × 100 steps, batch 6, renders + 1,474 YuE2 + found | 6.7% | 17.3% | 11.3% | 24.2% |

### Reference point: JigRipper model #1006 (2026-10-26)

JigRipper's public web model, run offline on the YouTube clips with their own front end, KeyCanon
and per-tune max (harness kept outside the repo; their weights are never shipped or committed).
It is a closed-set classifier over its full 22,410-tune catalogue, so the candidate set is the whole
catalogue. Windows are 8 s, taken every 1 s, and softmax-averaged (T = 1.5) over the 15 s clip.

| Labels | n | top-1 first 8 s | top-1 clip | top-5 clip |
|---|---|---|---|---|
| verified | 65 | | 84.6% | 90.8% |
| all (verified + unreviewed) | 185 | 45.9% | 63.2% | 72.4% |

By instrument (all labels, top-1 per clip): accordion 76%, banjo 75%, tin whistle 72%, session 71%,
flute 71%, fiddle 50%, concertina 48%, uilleann pipes 43%. When the best window cosine is ≥ 0.35 it
answers 61% of clips at 87% precision; at ≥ 0.40, 47% at 91%.

### Closed-set classifier (train/classifier.py), 2026-10-26

A transformer trained on our own pitch-class front end with a sub-center ArcFace head (Partial FC, 4,096 sampled
negatives) over all 23,305 catalog tunes. Training ran in two stages. The curriculum stages (2,000 tunes,
then the full catalog) ran on simulated, rendered and found audio on mantis. The fine-tune (`ft1`, 20k steps on a
Vast 4090) added 99,774 windows of YuE2 performances (2,704 tunes, none from the benchmarks). Clip score:
softmax-averaged 8 s windows, one per second. Re-ranking covers the top 10 by log p + a·log(tunebooks + 1) + w·alignment
(tunebook_ml/align.py).

| Model | YouTube top-1 (185) | verified (65) | YouTube top-5 | bands (75) | albums (96) |
|---|---|---|---|---|---|
| curriculum stage 2, sim + renders + found | 4.3% | 3.1% | 13.0% | 1.3% | 6.2% |
| ft1 (+ YuE2) | 22.2% | 24.6% | 43.2% | 13.3% | 21.9% |
| ft1 + alignment (w = 10) | 29.7% | 33.8% | | 21.3% | 30.2% |
| ft1 + prior a = 0.5 + alignment | 38.4% | 46.2% | | 22.7% | 36.5% |
| ft1 + prior a = 1 + alignment | 49.2% | 69.2% | | 20.0% | 38.5% |
| JigRipper #1006, model only (above) | 63.2% | 84.6% | 72.4% | | |

The popularity prior flatters YouTube and albums, whose benchmark tunes skew popular; on bands (less popular
valid/test tunes) it adds little. The prior-free comparison with JigRipper is ~30% vs 63%.
Training accuracy hit 97% against ~22% on real clips, so the cached real-sounding windows are being memorised.
