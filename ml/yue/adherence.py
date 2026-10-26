"""Scores whether a YuE2 clip actually plays the melody it was given.

YuE2 sometimes keeps the accompaniment and drops the tune, or talks over it. The melody's
pitch classes are laid over the clip's pitch-class salience (tunebook_ml.pitchclass) at
the tempo and offset that fit best. The score compares that fit with the same notes in a
shuffled pitch order: backing alone fits the key, so it fits shuffled notes about as well,
while a clip that plays the tune fits only the real order.

    uv run python yue/adherence.py cache/yue/listen-out/19969-s39514-0.flac --events cache/yue/listen/19969-s39514-0/events.json
    uv run python yue/adherence.py --index data/yue/train/vast --requests cache/yue/train.jsonl
"""

import argparse
import json
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile
import torch

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML)]

from tunebook_ml.pitchclass import FPS, SAMPLE_RATE, from_audio  # noqa: E402


def load(path: Path) -> np.ndarray:
    audio, rate = soundfile.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != SAMPLE_RATE:
        import scipy.signal
        audio = scipy.signal.resample_poly(audio, SAMPLE_RATE, rate).astype(np.float32)
    return audio


def score(audio: np.ndarray, notes: list, bpm: float | None = None) -> dict:
    """Notes are events.json notes: [onset, length] in quarters as fraction strings, MIDI pitch."""
    pcs = from_audio(torch.from_numpy(audio)[None], canon=False)[0].numpy()  # (12, T)
    onsets = np.array([float(Fraction(n[0])) for n in notes])
    ends = onsets + np.array([float(Fraction(n[1])) for n in notes])
    classes = np.array([n[2] % 12 for n in notes])
    quarters = ends.max()
    seconds = pcs.shape[1] / FPS
    # Seconds per quarter: around the requested tempo when known, otherwise whatever fits the clip.
    if bpm:
        spqs = 60 / bpm * np.linspace(0.9, 1.1, 21)
    else:
        spqs = seconds / quarters * np.linspace(0.45, 1.0, 45)
    best = {"fit": -np.inf}
    spectra = np.fft.rfft(pcs, n=2 * pcs.shape[1], axis=1)
    for spq in spqs:
        length = int(quarters * spq * FPS)
        if length >= pcs.shape[1] or length < FPS * 5:
            continue
        target = np.zeros((12, length), dtype=np.float32)
        for onset, end, pc in zip(onsets, ends, classes):
            target[pc, int(onset * spq * FPS):max(int(end * spq * FPS), int(onset * spq * FPS) + 1)] = 1
        # Cross-correlation over every offset at which the melody fits inside the clip.
        corr = np.fft.irfft(spectra * np.conj(np.fft.rfft(target, n=2 * pcs.shape[1], axis=1)), axis=1).sum(axis=0)
        corr = corr[: pcs.shape[1] - length + 1] / target.sum()
        if corr.max() > best["fit"]:
            best = {"fit": float(corr.max()), "spq": spq, "start": int(corr.argmax())}
    if "spq" not in best:
        return {"ratio": None, "seconds": round(seconds, 1)}
    spq, start = best.pop("spq"), best.pop("start")
    rng = np.random.default_rng(0)
    shuffled = []
    for _ in range(20):
        order = rng.permutation(classes)
        total = hits = 0.0
        for onset, end, pc in zip(onsets, ends, order):
            a = start + int(onset * spq * FPS)
            b = max(start + int(end * spq * FPS), a + 1)
            hits += pcs[pc, a:b].sum()
            total += b - a
        shuffled.append(hits / total)
    best.update(ratio=round(float(best["fit"] / (np.mean(shuffled) + 1e-6)), 2), fit=round(best["fit"], 3),
                bpm=round(float(60 / spq), 1), offset=round(start / FPS, 1))
    best["seconds"] = round(seconds, 1)
    best["melody_seconds"] = round(float(quarters * 60 / best["bpm"]), 1) if "bpm" in best else None
    return best


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clips", nargs="*", type=Path)
    parser.add_argument("--events", type=Path, help="events.json for a single clip")
    parser.add_argument("--index", type=Path, nargs="*", help="batch.py output folders: score every ok clip")
    parser.add_argument("--requests", type=Path, help="the JSONL those clips were generated from")
    parser.add_argument("--out", type=Path, help="write one JSON line per clip here")
    args = parser.parse_args()

    if args.events:
        events = json.loads(args.events.read_text())
        for clip in args.clips:
            print(clip.name, score(load(clip), events["notes"], events["bpm"]))
        return
    requests = {row["name"]: row for row in map(json.loads, args.requests.open())}
    out = args.out.open("a") if args.out else None
    done = {json.loads(line)["name"] for line in args.out.open()} if args.out and args.out.stat().st_size else set()
    for folder in args.index:
        for line in sorted(folder.glob("index-*.jsonl")):
            for row in map(json.loads, line.open()):
                clip = folder / f"{row['name']}.ogg"
                if row["status"] != "ok" or row["name"] in done or not clip.exists() or row["name"] not in requests:
                    continue
                events = requests[row["name"]]["events"]
                result = {"name": row["name"], **score(load(clip), events["notes"], events["bpm"])}
                done.add(row["name"])
                print(json.dumps(result))
                if out:
                    out.write(json.dumps(result) + "\n")
                    out.flush()


if __name__ == "__main__":
    main()
