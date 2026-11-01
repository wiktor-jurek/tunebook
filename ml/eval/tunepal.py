"""Tunepal's method on our eval clips, beside the finder on the same seconds.

Tunepal (Bryan Duggan) turns about 10 s of playing into a string of note letters, one per quaver
(sharps spelt as the natural below, "C#" → "C"), and ranks tunes by the substring edit distance from
that string to each tune's stored letter string: confidence = 1 - distance / length. The search and the
corpus come from the author's open rebuild, github.com/skooter500/TunepalGodot (src/tunepal.cpp,
Scripts/record.gd, data/tunepal.db). Its thesession.org source holds 12,387 tunes keyed by The Session
tune id, so answers map straight onto our labels.

The shipping app's pitch tracker is not in that repo, so two front ends bracket it:
- "prototype": record.gd ported as written — the loudest FFT bin each frame (Godot's 1024-point
  spectrum at 48 kHz, 60 frames a second), a note entered once seen in two frames, notes under 0.1 s
  merged, the quaver taken as the mean of the largest group of similar note lengths;
- "yin strict" and "yin": the same note segmentation and letter string, fed by a YIN pitch tracker
  instead. Strict voicing (0.15, as for clean signals) misses most frames of a fiddle; loose voicing
  (0.5) hears the whole melody of a solo player but also transcribes the backing. Strict is better on
  albums and sessions, loose on YouTube. The better of the two in each set is Tunepal's method at its best.

Benchmark only: tunepal.db never ships and is never trained on (as for JigRipper, PIPELINE.md §10).

    curl -L -o data/tunepal/tunepal.db https://github.com/skooter500/TunepalGodot/raw/HEAD/TunepalGodot/data/tunepal.db
    python eval/tunepal.py                     # first 10 s of every clips-v4 clip
    python eval/tunepal.py --seconds 20 --sets youtube
"""

import argparse
import json
import math
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import numba
import numpy as np
import torch

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML / "train"))
import classifier as c  # noqa: E402

# record.gd's note table: B2 to B8 and their spellings, sharps folded onto the natural below.
FUNDAMENTALS = 123.471 * 2 ** (np.arange(73) / 12)
SPELLINGS = [["B", "C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A"][i % 12] for i in range(73)]
FPS = 60  # Godot's physics rate: record.gd samples the spectrum once a physics frame


# ── Search: src/tunepal.cpp ──────────────────────────────────────────────────────────


@numba.njit(cache=True)
def _ed_substring(pattern: np.ndarray, text: np.ndarray) -> int:
    """Edit distance from the pattern to its best-matching substring of the text; 'Z' in the
    pattern matches anything. tunepal.cpp's edSubstring, one row at a time."""
    previous = np.zeros(len(text) + 1, dtype=np.int32)
    current = np.zeros(len(text) + 1, dtype=np.int32)
    for i in range(1, len(pattern) + 1):
        current[0] = i
        sc = pattern[i - 1]
        for j in range(1, len(text) + 1):
            difference = 0 if (text[j - 1] == sc or sc == 90) else 1
            current[j] = min(min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + difference)
        previous, current = current, previous
    return previous.min()


@numba.njit(parallel=True, cache=True)
def _search(pattern: np.ndarray, corpus: np.ndarray, starts: np.ndarray) -> np.ndarray:
    out = np.empty(len(starts) - 1, dtype=np.float32)
    for k in numba.prange(len(starts) - 1):
        out[k] = 1.0 - _ed_substring(pattern, corpus[starts[k]:starts[k + 1]]) / len(pattern)
    return out


class Corpus:
    """thesession.org keys from tunepal.db; record.gd skips keys under 50 letters."""

    def __init__(self, path: Path):
        db = sqlite3.connect(path)
        rows = [(int(x), key) for x, key in db.execute(
            "select t.x, k.search_key from tuneindex t join tunekeys k on k.tuneid = t.id where t.source = 1")
            if key and len(key) >= 50]
        self.tunes = sorted({x for x, _ in rows})
        column = {t: i for i, t in enumerate(self.tunes)}
        self.owner = np.array([column[x] for x, _ in rows])
        encoded = [np.frombuffer(key.encode("ascii", "replace"), dtype=np.uint8) for _, key in rows]
        self.starts = np.concatenate([[0], np.cumsum([len(e) for e in encoded])]).astype(np.int64)
        self.corpus = np.concatenate(encoded)

    def scores(self, letters: str) -> np.ndarray:
        """Each tune's best confidence over its keys."""
        best = np.full(len(self.tunes), -np.inf, dtype=np.float32)
        if letters:
            np.maximum.at(best, self.owner, _search(np.frombuffer(letters.encode(), dtype=np.uint8), self.corpus, self.starts))
        return best


# ── Transcription: Scripts/record.gd ─────────────────────────────────────────────────


def frames_prototype(audio: np.ndarray, rate: int) -> list[str | None]:
    """record.gd's pitch: the loudest spectrum bin from 100 Hz to 8 kHz, snapped to the nearest note.
    Godot's analyzer reports linear magnitudes and record.gd gates at 0.001; here the gate is 40 dB
    under the clip's loud frames, since our audio is normalised differently."""
    n_fft, hop = 1024, rate / FPS
    window = np.hanning(n_fft)
    freqs = np.fft.rfftfreq(n_fft, 1 / rate)
    band = (freqs >= 100) & (freqs < 8000)
    peaks, letters = [], []
    for start in np.arange(0, len(audio) - n_fft, hop).astype(int):
        spectrum = np.abs(np.fft.rfft(audio[start:start + n_fft] * window))[band]
        k = int(spectrum.argmax())
        peaks.append(spectrum[k])
        letters.append(SPELLINGS[int(np.abs(FUNDAMENTALS - freqs[band][k]).argmin())])
    gate = np.percentile(peaks, 95) * 0.01 if peaks else 0
    return [letter if peak > gate else None for letter, peak in zip(letters, peaks)]


def frames_yin(audio: np.ndarray, rate: int, threshold: float = 0.2, voicing: float = 0.5) -> list[str | None]:
    """YIN (de Cheveigné & Kawahara 2002) at the same 60 frames a second, B2 to D7 (the whistle's top).
    The period is the first dip under `threshold`, else the deepest dip; a frame counts as a note
    when that dip is under `voicing`. Clean-signal YIN (0.15, no fallback) voiced 2% of a fiddle clip."""
    n, hop = 1024, rate / FPS
    tau_min, tau_max = int(rate / 2500), int(rate / 115)
    starts = np.arange(0, len(audio) - n - tau_max, hop).astype(int)
    if not len(starts):
        return []
    frames = np.stack([audio[s:s + n + tau_max] for s in starts])
    energy = (frames[:, :n] ** 2).mean(1)
    # Difference function d(tau) = sum (x_j - x_{j+tau})^2 over the first n samples, by FFT.
    size = 1 << int(np.ceil(np.log2(2 * (n + tau_max))))
    spec = np.fft.rfft(frames, size)
    head = np.fft.rfft(frames[:, :n], size)
    cross = np.fft.irfft(spec * np.conj(head), size)[:, :tau_max + 1]
    squares = np.concatenate([np.zeros((len(frames), 1)), np.cumsum(frames ** 2, axis=1)], axis=1)
    lag_energy = squares[:, n:n + tau_max + 1] - squares[:, :tau_max + 1]
    d = squares[:, n:n + 1] + lag_energy - 2 * cross
    d[:, 0] = 0
    cmnd = d[:, 1:] * np.arange(1, tau_max + 1) / np.maximum(np.cumsum(d[:, 1:], axis=1), 1e-12)
    gate = np.percentile(energy, 95) * 1e-3
    out: list[str | None] = []
    for row, e in zip(cmnd, energy):
        below = np.nonzero(row[tau_min - 1:] < threshold)[0]
        tau = below[0] + tau_min - 1 if len(below) else int(row[tau_min - 1:].argmin()) + tau_min - 1
        while tau + 1 < len(row) and row[tau + 1] < row[tau]:
            tau += 1  # down to the dip's floor
        if e <= gate or row[tau] >= voicing:
            out.append(None)
            continue
        lo, mid, hi = row[max(tau - 1, 0)], row[tau], row[min(tau + 1, len(row) - 1)]
        shift = 0.5 * (lo - hi) / (lo - 2 * mid + hi) if lo - 2 * mid + hi else 0.0
        frequency = rate / (tau + 1 + shift)
        out.append(SPELLINGS[int(np.abs(FUNDAMENTALS - frequency).argmin())])
    return out


def letters_from_frames(frames: list[str | None]) -> str:
    """record.gd's _physics_process note entry and stop_recording's string, ported as written."""
    notes: list[dict] = []
    pending: list[dict] = []
    last = 0.0
    for i, letter in enumerate(frames):
        now = i / FPS
        if letter is None:
            last = now
            continue
        hit = False
        for note in pending:
            if note["note"] == letter:
                hit = True
                note["count"] += 1
                if note["count"] == 2:
                    pending = []
                    elapsed = now - last
                    if not notes or notes[-1]["note"] != letter:
                        notes.append({"note": letter, "time": elapsed})
                    else:
                        notes[-1]["time"] += elapsed
                    last = now
        if not hit:
            pending.append({"note": letter, "count": 1})
    # Notes under 0.1 s fold into the one before (record.gd keeps its quirk of then adding the short one).
    kept: list[dict] = []
    for i, note in enumerate(notes):
        if note["time"] >= 0.1:
            kept.append(note)
        elif i:
            notes[i - 1]["time"] += note["time"]
            if notes[i - 1]["time"] >= 0.1 and notes[i - 1] not in kept:
                kept.append(note)
    if not kept:
        return ""
    # The quaver: the mean length of the largest group of lengths within 33% of each other.
    groups, group, average = [], [], 0.0
    for note in sorted(kept, key=lambda n: n["time"]):
        if average == 0:
            average = note["time"]
        if abs((average - note["time"]) / average) <= 0.33:
            group.append(note)
            average = sum(n["time"] for n in group) / len(group)
        else:
            groups.append(group)
            group, average = [note], 0.0
    groups.append(group)
    largest = max((g for g in groups if g), key=len)
    quaver = sum(n["time"] for n in largest) / len(largest)
    return "".join(n["note"] * max(1, int(n["time"] / quaver)) for n in kept)


# ── Benchmark ────────────────────────────────────────────────────────────────────────


def finder_scores(seconds: float) -> tuple:
    """The shipped finder's ranking from the windows inside the first `seconds` (8 s windows, one a
    second), and from the whole clip, with the popularity prior as decode.ts adds it."""
    from export_finder import Finder, load
    from tunebook_ml import pitchclass
    model, ckpt = load(str(ML / "runs/classifier/ft-clean/last.pt"), True, str(ML / "scratch/prototypes-ft-clean-128x16.pt"), 0.0, 8, 192)
    finder = Finder(model).eval()
    counts = c.popularity()
    prior = torch.tensor([0.006 * math.log(counts.get(t, 0) + 1) for t in ckpt["tune_ids"]])

    @torch.no_grad()
    def score(windows: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        cos = finder(pitchclass.keycanon(windows.float()))
        first = max(1, int(seconds) - 8 + 1)
        return cos[:first].mean(0) + prior, cos.mean(0) + prior
    return ckpt["tune_ids"], score


def rank(scores: np.ndarray, columns: dict[int, int], truth: int) -> int | None:
    if truth not in columns:
        return None
    return int((scores > scores[columns[truth]]).sum()) + 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=ML / "data" / "tunepal" / "tunepal.db")
    parser.add_argument("--clips", type=Path, default=ML / "cache" / "classifier" / "clips-v4.pt")
    parser.add_argument("--seconds", type=float, default=10.0, help="Tunepal records 10 s after its countdown")
    parser.add_argument("--sets", nargs="*", default=["youtube", "albums", "bands", "sessions"])
    parser.add_argument("--out", type=Path, default=ML / "scratch" / "tunepal-results.json")
    args = parser.parse_args()

    corpus = Corpus(args.db)
    columns = {t: i for i, t in enumerate(corpus.tunes)}
    print(f"tunepal.db: {len(corpus.tunes)} The Session tunes, {len(corpus.starts) - 1} keys", flush=True)
    clips = torch.load(args.clips, weights_only=False)
    tune_ids, finder = finder_scores(args.seconds)
    finder_columns = {t: i for i, t in enumerate(tune_ids)}
    rate = 48000
    results = []
    for name in args.sets:
        started = time.time()
        for row in clips[name]:
            audio48 = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", row["path"], "-t", str(args.seconds), "-ac", "1", "-ar", str(rate),
                                                    "-f", "f32le", "-"], capture_output=True, check=True).stdout, dtype=np.float32)
            record = {"set": name, "path": row["path"], "tune_id": row["tune_id"]}
            fronts = (("prototype", frames_prototype(audio48, rate)), ("yin strict", frames_yin(audio48, rate, 0.15, 0.15)), ("yin", frames_yin(audio48, rate)))
            for front, frames in fronts:
                letters = letters_from_frames(frames)
                record[f"{front} letters"] = letters
                record[f"{front} rank"] = rank(corpus.scores(letters), columns, row["tune_id"])
            first, whole = finder(row["windows"])
            record["finder rank"] = rank(first.numpy(), finder_columns, row["tune_id"])
            record["finder whole-clip rank"] = rank(whole.numpy(), finder_columns, row["tune_id"])
            results.append(record)
        print(f"{name}: {sum(r['set'] == name for r in results)} clips, {time.time() - started:.0f} s", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, indent=1))
    keys = ("prototype rank", "yin strict rank", "yin rank", "finder rank", "finder whole-clip rank")
    print(f"\nTop-1 / top-10 on clips whose tune is in tunepal.db; Tunepal and the finder hear the first {args.seconds:g} s")
    print(f"{'set':9} {'clips':>5}  " + "  ".join(f"{k.replace(' rank', ''):>22}" for k in keys))
    for name in args.sets:
        rows = [r for r in results if r["set"] == name and r["yin rank"] is not None]
        cells = []
        for k in keys:
            ranks = [r[k] for r in rows]
            cells.append(f"{np.mean([x == 1 for x in ranks]):6.1%} / {np.mean([x <= 10 for x in ranks]):6.1%}")
        print(f"{name:9} {len(rows):5}  " + "  ".join(f"{x:>22}" for x in cells))


if __name__ == "__main__":
    main()
