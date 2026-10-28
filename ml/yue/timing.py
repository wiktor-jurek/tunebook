"""Maps each play-along's audio onto its score, so the web player can follow along.

A YuE2 clip plays the melody it was given (yue/events.py), but late by a lead-in and at
its own pace, which drifts a little from the requested tempo. The melody's pitch classes
are laid over the clip's pitch-class salience at the tempo and offset that fit best (as in
yue/adherence.py), then each stretch of about a second is nudged to where it fits locally.
The result is a time map of [milliseconds into the clip, score position] anchors, where a
score position is in 1/48 of a whole note from the start of the score as abcjs plays it
(the catalog export's starts, lib/melody.ts), repeats and all.

Clips that do not play their tune (adherence ratio below MIN_RATIO) get no map, so the
player shows no position rather than a wrong one.

    uv run python yue/timing.py data/yue/train/vast/9993-s9993-0.ogg      # one clip, with a report
    uv run python yue/timing.py --manifest cache/yue/playalong/training.jsonl cache/yue/playalong/library-manifest.jsonl

Maps go to cache/yue/playalong/timings.jsonl by storage key, where
scripts/import-playalongs.ts picks them up.
"""

import argparse
import json
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
from pathlib import Path

import numpy as np
import torch

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML), str(ML / "yue")]

from tunebook_ml.pitchclass import FPS, SAMPLE_RATE, from_audio  # noqa: E402
from tunebook_ml.render import load_catalog  # noqa: E402

OUT = ML / "cache" / "yue" / "playalong" / "timings.jsonl"
REQUESTS = [ML / "cache" / "yue" / name for name in ("train.jsonl", "train2.jsonl", "train3.jsonl", "library.jsonl")]
REQUEST_FOLDERS = [ML / "cache" / "yue" / name for name in ("homer", "listen")]
UNIT = 48               # score positions in 1/48 of a whole note, as the catalog stores them
MIN_RATIO = 1.6         # adherence below this is mostly backing: no map
ANCHOR_SECONDS = 1.0    # one anchor about every second of melody
WINDOW_SECONDS = 2.0    # each anchor fits the melody this far either side of it
MAX_SHIFT = 0.4         # seconds an anchor may move from where the anchors before it were
MAX_DRIFT = 4.0         # seconds the anchors may wander from the global fit in all
SMOOTH = 5              # anchors in the median that steadies the local shifts


def load(path: Path) -> np.ndarray:
    """Mono audio at the pitch-class sample rate; ffmpeg decodes what soundfile cannot (AAC)."""
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def melody_target(onsets: np.ndarray, ends: np.ndarray, classes: np.ndarray, spq: float, length: int) -> np.ndarray:
    target = np.zeros((12, length), dtype=np.float32)
    for onset, end, pc in zip(onsets, ends, classes):
        a = int(onset * spq * FPS)
        target[pc, a:max(int(end * spq * FPS), a + 1)] = 1
    return target


def global_fit(pcs: np.ndarray, onsets, ends, classes, spqs) -> tuple[float, float, int]:
    """(fit, seconds per quarter, start frame) of the melody laid over the whole clip."""
    quarters = ends.max()
    spectra = np.fft.rfft(pcs, n=2 * pcs.shape[1], axis=1)
    best = (-np.inf, 0.0, 0)
    for spq in spqs:
        length = int(quarters * spq * FPS)
        if length >= pcs.shape[1] or length < FPS * 5:
            continue
        target = melody_target(onsets, ends, classes, spq, length)
        corr = np.fft.irfft(spectra * np.conj(np.fft.rfft(target, n=2 * pcs.shape[1], axis=1)), axis=1).sum(axis=0)
        corr = corr[: pcs.shape[1] - length + 1] / target.sum()
        if corr.max() > best[0]:
            best = (float(corr.max()), float(spq), int(corr.argmax()))
    return best


def shuffled_fit(pcs: np.ndarray, onsets, ends, classes, spq: float, start: int) -> float:
    """The same fit with the melody's pitches shuffled: what backing alone in the key scores."""
    rng = np.random.default_rng(0)
    fits = []
    for _ in range(20):
        order = rng.permutation(classes)
        hits = total = 0.0
        for onset, end, pc in zip(onsets, ends, order):
            a = start + int(onset * spq * FPS)
            b = max(start + int(end * spq * FPS), a + 1)
            hits += pcs[pc, a:b].sum()
            total += b - a
        fits.append(hits / total)
    return float(np.mean(fits))


def align(audio: np.ndarray, notes: list, bpm: float) -> dict:
    """Anchors as [seconds into the clip, quarters into the melody's events], plus how well it fits."""
    pcs = from_audio(torch.from_numpy(audio)[None], canon=False)[0].numpy()  # (12, T)
    onsets = np.array([float(Fraction(n[0])) for n in notes])
    ends = onsets + np.array([float(Fraction(n[1])) for n in notes])
    classes = np.array([n[2] % 12 for n in notes])
    # Coarse then fine: a 1% tempo error is half a bar out by the end of a 40 s clip.
    fit, spq, start = global_fit(pcs, onsets, ends, classes, 60 / bpm * np.linspace(0.9, 1.1, 21))
    if not spq:
        return {"ratio": None}
    fit, spq, start = global_fit(pcs, onsets, ends, classes, spq * np.linspace(0.99, 1.01, 21))
    ratio = fit / (shuffled_fit(pcs, onsets, ends, classes, spq, start) + 1e-6)
    result = {"ratio": round(ratio, 2), "bpm": round(60 / spq, 2), "offset": round(start / FPS, 2)}
    if ratio < MIN_RATIO:
        return result

    # Local nudges: each anchor's stretch of melody slides up to MAX_SHIFT around where the last few
    # anchors were, so a clip that slowly speeds up or slows down is followed all the way through.
    step = max(Fraction(1, 2), Fraction(round(ANCHOR_SECONDS / spq * 2), 2))
    width, reach = WINDOW_SECONDS / spq, int(MAX_SHIFT * FPS)
    anchors = np.arange(float(onsets.min()), float(ends.max()), float(step))
    shifts = []
    for q in anchors:
        inside = (ends > q - width) & (onsets < q + width)
        recent = [s for s in shifts[-SMOOTH:] if not np.isnan(s)]
        centre = int(round(float(np.clip(np.median(recent), -MAX_DRIFT, MAX_DRIFT)) * FPS)) if recent else 0
        if inside.sum() < 3:
            shifts.append(np.nan)
            continue
        lo = q - width
        target = melody_target(np.maximum(onsets[inside], lo) - lo, np.minimum(ends[inside], q + width) - lo, classes[inside], spq, int(2 * width * spq * FPS) + 1)
        at = start + int(lo * spq * FPS) + centre
        scores = []
        for shift in range(-reach, reach + 1):
            a = at + shift
            if a < 0 or a + target.shape[1] > pcs.shape[1]:
                scores.append(-np.inf)
                continue
            scores.append(float((pcs[:, a:a + target.shape[1]] * target).sum() / target.sum()))
        scores = np.array(scores)
        # Flat fits (a held note, backing alone) say nothing about where the melody is.
        shifts.append(np.nan if not np.isfinite(scores.max()) or scores.max() < fit * 0.6 else float(centre + scores.argmax() - reach) / FPS)
    shifts = np.array(shifts)
    known = ~np.isnan(shifts)
    if known.sum() < 2:
        shifts = np.zeros_like(anchors)
    else:
        shifts = np.interp(anchors, anchors[known], shifts[known])
    half = SMOOTH // 2
    padded = np.pad(shifts, half, mode="edge")
    shifts = np.array([np.median(padded[i:i + SMOOTH]) for i in range(len(shifts))])
    times = start / FPS + anchors * spq + shifts
    seconds = pcs.shape[1] / FPS
    keep, last = [], -np.inf
    for t, q in zip(times, anchors):
        if last < t <= seconds:  # times only move forward, and stop where the clip does
            keep.append((float(t), float(q)))
            last = t
    end = start / FPS + float(ends.max()) * spq + shifts[-1]
    if last < end <= seconds:
        keep.append((end, float(ends.max())))
    result.update(anchors=keep, drift=round(float(np.abs(shifts).max()), 2))
    return result


def score_position(notes: list, setting: dict) -> tuple[Fraction, Fraction, int]:
    """(events quarter of the score's start, events quarters per written quarter, score length in 1/48)
    for a melody yue/events.py wrote from this catalog setting."""
    starts, durations = setting["starts"], setting["durations"]
    onsets = [Fraction(n[0]) for n in notes]
    # Fast tunes were written in halved note values at half the tempo: compare a few notes in.
    k = min(8, len(onsets) - 1, len(starts) - 1)
    written = Fraction(starts[k] - starts[0], 12)
    scale = Fraction(1) if not written else Fraction(2) ** round(float(np.log2(float((onsets[k] - onsets[0]) / written))))
    origin = onsets[0] - Fraction(starts[0], 12) * scale
    return origin, scale, starts[-1] + durations[-1]


def time_map(alignment: dict, notes: list, setting: dict) -> dict | None:
    """Anchors for the web player: [ms into the clip, score position in 1/48 of a whole note]."""
    if not alignment.get("anchors"):
        return None
    origin, scale, length = score_position(notes, setting)
    anchors = [[round(t * 1000), round(float((Fraction(q).limit_denominator(1000) - origin) * 12 / scale))] for t, q in alignment["anchors"]]
    anchors = [anchor for anchor in anchors if anchor[1] >= -UNIT]  # a lead-in before the score starts is kept briefly
    # Played more than once through (events.py --times), each time starts a whole number of bars later.
    meter = setting.get("meter") or "4/4"
    numerator, denominator = (int(x) for x in meter.split("/"))
    bar = UNIT * numerator // denominator
    loop = -(-length // bar) * bar
    return {"anchors": anchors, "loop": loop} if anchors[-1][1] > loop else {"anchors": anchors}


def requests() -> dict[str, dict]:
    rows = {}
    for path in REQUESTS:
        if path.exists():
            rows.update({row["name"]: row for row in map(json.loads, path.open())})
    return rows


def source(entry: dict, known: dict[str, dict]) -> tuple[Path, list, float] | None:
    """Local audio and its melody events for a manifest entry, or None when either is gone."""
    key = entry["storageKey"]
    name = Path(key).stem
    if key.startswith("yue/train/"):
        folder = ML / "data" / "yue" / "train" / key.split("/")[2]
    elif key.startswith("playalong/library/"):
        folder = ML / "data" / "yue" / "library"
    else:
        folder = ML / "cache" / "yue" / "playalong" / key.split("/")[1]
    audio = next((folder / f"{name}{ext}" for ext in (".ogg", ".flac", ".m4a") if (folder / f"{name}{ext}").exists()), None)
    events = known[name]["events"] if name in known else next(
        (json.loads((f / name / "events.json").read_text()) for f in REQUEST_FOLDERS if (f / name / "events.json").exists()), None)
    return (audio, events["notes"], events["bpm"]) if audio and events else None


def work(job: tuple[dict, Path, list, float, dict]) -> dict:
    entry, audio, notes, bpm, setting = job
    try:
        alignment = align(load(audio), notes, bpm)
        return {"storageKey": entry["storageKey"], "ratio": alignment["ratio"], "drift": alignment.get("drift"),
                "timing": time_map(alignment, notes, setting)}
    except Exception as error:  # one unreadable clip should not stop the rest
        return {"storageKey": entry["storageKey"], "error": str(error)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clips", nargs="*", type=Path, help="report on single clips, named as their requests are")
    parser.add_argument("--manifest", nargs="*", type=Path, default=[], help="play-along manifests to map")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    known = requests()
    catalog = {row["settingId"]: row for row in load_catalog()}

    for clip in args.clips:
        request = known[clip.stem]
        events = request["events"]
        alignment = align(load(clip), events["notes"], events["bpm"])
        timing = time_map(alignment, events["notes"], catalog[request["setting_id"]])
        print(clip.name, {k: v for k, v in alignment.items() if k != "anchors"}, f"requested {events['bpm']} BPM")
        for t, position in (timing or {}).get("anchors", []):
            print(f"  {t / 1000:7.2f}s  {position / UNIT:6.2f} whole notes into the score")
    if not args.manifest:
        return

    done = {json.loads(line)["storageKey"] for line in OUT.open()} if OUT.exists() else set()
    jobs = []
    for manifest in args.manifest:
        for entry in map(json.loads, manifest.open()):
            if entry["storageKey"] in done or entry["settingId"] not in catalog:
                continue
            found = source(entry, known)
            if found:
                jobs.append((entry, *found, catalog[entry["settingId"]]))
                done.add(entry["storageKey"])
    jobs = jobs[: args.limit] if args.limit else jobs
    print(f"{len(jobs)} clips to map", flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    mapped = 0
    with OUT.open("a") as out, ProcessPoolExecutor(args.workers, initializer=torch.set_num_threads, initargs=(1,)) as pool:
        for i, row in enumerate(pool.map(work, jobs, chunksize=4), 1):
            out.write(json.dumps(row) + "\n")
            out.flush()
            mapped += bool(row.get("timing"))
            if i % 200 == 0:
                print(f"{i}/{len(jobs)}, {mapped} mapped", flush=True)
    print(f"{mapped} of {len(jobs)} clips mapped → {OUT}")


if __name__ == "__main__":
    main()
