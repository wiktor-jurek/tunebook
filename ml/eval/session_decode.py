"""The live decoder on whole session recordings: how soon each tune of a set is named, and how often a wrong tune is.

The app scores the last 8 s of audio once a second and adds a tune to the session's list whenever the decoder is sure of
one that differs from the last added (apps/web/src/lib/finder/decode.ts, use-listener.ts). This replays that over the
session videos (cache/youtube/full/) against their checked sets in the data home, so decoder changes can be tried
without a phone in a pub. The shipped model runs once per recording; each window's top 256 tunes are kept
(cache/decode/{video}.npz) and the decoder sees every other tune at that window's 256th cosine.

    uv run --group store --group train --with onnxruntime python eval/session_decode.py score        # once: the cosines
    uv run --group store --group train --with onnxruntime python eval/session_decode.py compare      # the variants below

Measures, over checked tunes in fully checked sets (a tune that repeats the one before it is skipped):
  found     the tune was added while it played, and `in 10 s` / `in 15 s` of its start
  latency   median seconds from its start to being added
  wrong     tunes added while another, labelled tune played: per labelled hour. Each is a wrong line in the setlist.
  wrong %   those as a share of every tune added while a labelled tune played
  outside   tunes added while no labelled tune played, per hour of that time: talk, gaps and tuning up, but also any
            set not fully checked, so only a rough stand-in for naming tunes in noise
Variants are tuned on half the videos (`--half a`) and checked on the other half (`--half b`).
"""

import argparse
import csv
import json
import subprocess
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tunebook_ml import pitchclass, store  # noqa: E402

ML = Path(__file__).resolve().parents[1]
REPO = ML.parent
FULL = ML / "cache" / "youtube" / "full"
SOUNDCLOUD = ML / "cache" / "soundcloud" / "full"  # eval/soundcloud.py
OUT = ML / "cache" / "decode"
MODEL = REPO / "apps" / "web" / "public" / "finder" / "model.onnx"
TOP = 256
CHUNK = 300
SILENCE = 0.003  # worker.ts
PRIOR = 0.006  # decode.ts POPULARITY_WEIGHT
FRAMES = 400  # 8 s at 50 frames a second


# classifier.py's read_audio, windows and popularity, without the simulator it imports (which needs FluidSynth).
def read_audio(path: Path, start: float, duration: float) -> np.ndarray:
    args = ["ffmpeg", "-v", "error", "-ss", str(start), "-i", str(path), "-t", str(duration), "-ac", "1", "-ar", str(pitchclass.SAMPLE_RATE), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, dtype=np.float32)


def windows(audio: np.ndarray) -> torch.Tensor:
    """Pre-KeyCanon features of every 8 s window, one a second: (N, channels, FRAMES)."""
    length = FRAMES * pitchclass.HOP
    batch = torch.stack([torch.from_numpy(np.pad(audio[s:s + length], (0, max(0, s + length - len(audio)))))
                         for s in range(0, max(1, len(audio) - length + 1), pitchclass.SAMPLE_RATE)])
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return torch.cat([pitchclass.features(pitchclass.semitones(batch[i:i + 32].to(device))[:, :, :FRAMES], canon=False).half().cpu()
                      for i in range(0, len(batch), 32)])


def popularity() -> dict[int, int]:
    with (ML / "data" / "tune_popularity.csv").open() as handle:
        return {int(row["tune_id"]): int(row["tunebooks"]) for row in csv.DictReader(handle)}


def model_session(model: Path):
    import onnxruntime as ort
    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    return ort.InferenceSession(str(model), providers=providers)


def score(args) -> None:
    session = model_session(args.model)
    for video in sorted([*FULL.glob("*.flac"), *SOUNDCLOUD.glob("*.flac")]):
        score_file(video, session)


def score_file(video: Path, session) -> Path:
    """One recording's windows (cache/decode/{stem}.npz), unless already there."""
    OUT.mkdir(parents=True, exist_ok=True)
    channels = session.get_inputs()[0].shape[1]
    target = OUT / f"{video.stem}.npz"
    if not target.exists():
        idx, val, quiet = [], [], []
        start = 0
        while True:
            audio = read_audio(video, start=start, duration=CHUNK + 8)
            if len(audio) < 8 * pitchclass.SAMPLE_RATE:
                break
            n = min(CHUNK, (len(audio) - 8 * pitchclass.SAMPLE_RATE) // pitchclass.SAMPLE_RATE + 1)
            features = windows(audio)[:n]
            assert features.shape[1] == channels, f"model takes {channels} channels, features have {features.shape[1]} (TUNEBOOK_FEATURES)"
            cos = np.concatenate([session.run(None, {"windows": pitchclass.keycanon(features[i:i + 64].float()).numpy()})[0]
                                  for i in range(0, n, 64)])
            top = np.argpartition(-cos, TOP, axis=1)[:, :TOP]
            idx.append(top.astype(np.int32))
            val.append(np.take_along_axis(cos, top, axis=1).astype(np.float16))
            rms = [np.sqrt(np.mean(audio[s * pitchclass.SAMPLE_RATE:(s + 8) * pitchclass.SAMPLE_RATE] ** 2)) for s in range(n)]
            quiet.append(np.array(rms) < SILENCE)
            start += CHUNK
            print(f"{video.stem}: {start // 60} min", end="\r", flush=True)
        np.savez(target, idx=np.concatenate(idx), val=np.concatenate(val), quiet=np.concatenate(quiet))
        print(f"{video.stem}: {sum(len(i) for i in idx)} windows")
    return target


@dataclass(frozen=True)
class Settings:
    """decode.ts's constants, and the changes tried on top of them."""
    history: int = 30  # windows averaged (HISTORY)
    margin: float = 0.04  # MATCH_MARGIN
    stable: int = 2  # STABLE_UPDATES
    min_windows: int = 3  # MIN_WINDOWS
    # Change detection: when the last `short` windows have a different leader, ahead by `short_margin`, for
    # `short_stable` seconds in a row, the history is cut to those windows, so a new tune need not outvote 30 s of the old.
    short: int = 0
    short_margin: float = 0.0
    short_stable: int = 1
    # Switching: a tune other than the one last added must lead by this much more than `margin`.
    switch_extra: float = 0.0
    # Two views: once a tune is named, the mean of only the last `switch_window` windows decides whether the music has
    # moved on (its leader ahead by margin + switch_extra for `stable` updates); the history is then cut to those windows.
    # Naming the first tune, and staying on it, keep the long history.
    switch_window: int = 0
    # A floor on the leader's score (mean cosine plus the popularity prior): below it nothing is named, however far ahead
    # the leader is. Suggested by Cadence's author: most wrong names sit at low absolute scores, and on bar noise.
    floor: float = 0.0

    def label(self) -> str:
        base = Settings()
        changed = [f"{k}={v:g}" if isinstance(v, float) else f"{k}={v}" for k, v in self.__dict__.items() if getattr(base, k) != v]
        return ", ".join(changed) or "shipped"


class Decoder:
    def __init__(self, s: Settings, prior: np.ndarray):
        self.s, self.prior = s, prior
        self.windows: deque[np.ndarray] = deque()
        self.total = np.zeros_like(prior)
        self.leaders: deque[int] = deque(maxlen=s.stable)
        self.short_run = 0
        self.last_added = -1
        self.recent_leaders: deque[int] = deque(maxlen=s.stable)

    def push(self, w: np.ndarray) -> int | None:
        """One window's cosines → the tune to add to the list, if any."""
        s = self.s
        self.windows.append(w)
        self.total += w
        while len(self.windows) > s.history:
            self.total -= self.windows.popleft()
        if s.short and len(self.windows) > s.short:
            recent = sum(list(self.windows)[-s.short:]) / s.short + self.prior
            long_leader = int(np.argmax(self.total / len(self.windows) + self.prior))
            top2 = np.partition(recent, -2)[-2:]
            leader = int(np.argmax(recent))
            self.short_run = self.short_run + 1 if leader != long_leader and top2[1] - top2[0] >= s.short_margin else 0
            if self.short_run >= s.short_stable:
                while len(self.windows) > s.short:
                    self.total -= self.windows.popleft()
                self.short_run = 0
        if s.switch_window and self.last_added >= 0 and len(self.windows) >= s.switch_window:
            recent = sum(list(self.windows)[-s.switch_window:]) / s.switch_window + self.prior
            r2 = np.argpartition(-recent, 2)[:2]
            ra, rb = (r2 if recent[r2[0]] >= recent[r2[1]] else r2[::-1])
            self.recent_leaders.append(int(ra))
            if (ra != self.last_added and recent[ra] - recent[rb] >= s.margin + s.switch_extra and recent[ra] >= s.floor
                    and len(self.recent_leaders) == s.stable and len(set(self.recent_leaders)) == 1):
                while len(self.windows) > s.switch_window:
                    self.total -= self.windows.popleft()
                self.leaders.clear()
                self.leaders.extend([int(ra)] * s.stable)
                self.last_added = int(ra)
                return int(ra)
        scores = self.total / len(self.windows) + self.prior
        top2 = np.argpartition(-scores, 2)[:2]
        a, b = (top2 if scores[top2[0]] >= scores[top2[1]] else top2[::-1])
        margin = scores[a] - scores[b]
        self.leaders.append(int(a))
        stable = len(self.leaders) == s.stable and len(set(self.leaders)) == 1
        need = s.margin + (s.switch_extra if self.last_added >= 0 and a != self.last_added else 0)
        if len(self.windows) >= s.min_windows and margin >= need and scores[a] >= s.floor and stable and a != self.last_added:
            self.last_added = int(a)
            return int(a)
        return None


def recordings(kinds: tuple[str, ...] = ("youtube_full",)) -> dict[str, dict]:
    """Each session recording's windows and its fully checked sets: [(start, end, tune)] in recording seconds."""
    tunes = json.loads((MODEL.parent / "tunes.json").read_text())
    rows = [r for kind in kinds for r in store.segments(kind=kind)]
    sets: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        if r["set_id"]:
            sets.setdefault((r["external_id"], r["set_id"]), []).append(r)
    out = {}
    for (video, _), segs in sets.items():
        if not (OUT / f"{video}.npz").exists() or any(r["verified"] != "yes" or r["tune_id"] is None for r in segs):
            continue
        out.setdefault(video, {"spans": []})["spans"].extend(sorted((float(r["start_s"]), float(r["end_s"]), int(r["tune_id"])) for r in segs))
    for video, rec in out.items():
        data = np.load(OUT / f"{video}.npz")
        rec.update(idx=data["idx"], val=data["val"].astype(np.float32), quiet=data["quiet"], tunes=tunes)
    return out


def replay(rec: dict, s: Settings, prior: np.ndarray) -> list[tuple[float, int]]:
    """(seconds into the video, tune index) for every tune added. Window k covers [k, k + 8), so it is heard at k + 8."""
    decoder = Decoder(s, prior)
    added = []
    for k in range(len(rec["idx"])):
        if rec["quiet"][k]:
            continue
        w = np.full(len(prior), rec["val"][k].min(), dtype=np.float32)
        w[rec["idx"][k]] = rec["val"][k]
        tune = decoder.push(w)
        if tune is not None:
            added.append((k + 8.0, tune))
    return added


def measure(recs: dict[str, dict], s: Settings | None, prior: np.ndarray | None, shown: dict[str, list] | None = None) -> dict:
    """`shown`: instead of replaying the decoder, each video's (seconds, tune id) as another app added them."""
    found = in10 = in15 = total = wrong = named = outside = 0
    latencies, hours, unlabelled = [], 0.0, 0.0
    for video, rec in recs.items():
        ids = rec["tunes"]
        added = shown[video] if shown is not None else [(t, ids[i]) for t, i in replay(rec, s, prior)]
        # Names given while no labelled tune plays: talk, gaps between sets, tuning up (and any set not fully checked).
        outside += sum(1 for t, _ in added if not any(start <= t < end for start, end, _ in rec["spans"]))
        unlabelled += max(0.0, len(rec["idx"]) - sum(end - start for start, end, _ in rec["spans"])) / 3600
        previous = None
        for start, end, tune in rec["spans"]:
            hours += (end - start) / 3600
            wrong += sum(1 for t, a in added if start <= t < end and a != tune)
            named += sum(1 for t, a in added if start <= t < end)
            if tune == previous:
                continue
            previous = tune
            total += 1
            hit = next((t - start for t, a in added if a == tune and start <= t < end), None)
            if hit is not None:
                found += 1
                latencies.append(hit)
                in10 += hit <= 10
                in15 += hit <= 15
    return {"tunes": total, "found": found / total, "in10": in10 / total, "in15": in15 / total,
            "latency": float(np.median(latencies)) if latencies else None, "wrong_per_hour": wrong / hours, "wrong": wrong, "hours": hours,
            "wrong_share": wrong / max(named, 1), "outside_per_hour": outside / max(unlabelled, 1e-9), "unlabelled_hours": unlabelled}


VARIANTS = [Settings()] + [Settings(history=h) for h in (10, 15, 20)] + [
    Settings(short=s, short_margin=m, short_stable=k) for s in (6, 8, 10) for m in (0.03, 0.05) for k in (2, 4)] + [
    Settings(history=h, switch_extra=e) for h in (10, 15) for e in (0.02, 0.04)] + [
    Settings(short=8, short_margin=m, short_stable=k, switch_extra=e) for m in (0.03, 0.05) for k in (2, 4) for e in (0.01, 0.02)]


KINDS = {"youtube": ("youtube_full",), "soundcloud": ("soundcloud_full",), "all": ("youtube_full", "soundcloud_full")}


def compare(args) -> None:
    recs = recordings(KINDS[args.kind])
    videos = sorted(recs)
    if args.half:
        videos = videos[0::2] if args.half == "a" else videos[1::2]
        recs = {v: recs[v] for v in videos}
    any_rec = next(iter(recs.values()))
    counts = popularity()
    prior = (PRIOR * np.log(np.array([counts.get(t, 0) for t in any_rec["tunes"]], dtype=np.float32) + 1)).astype(np.float32)
    variants = [Settings(**json.loads(v)) for v in args.variant] if args.variant else VARIANTS
    print(f"{len(videos)} videos, {sum(len(r['spans']) for r in recs.values())} checked tunes, "
          f"{measure(recs, Settings(), prior)['unlabelled_hours']:.1f} h outside them")
    print(f"{'variant':58} {'found':>6} {'≤10 s':>6} {'≤15 s':>6} {'median':>7} {'wrong/h':>8} {'wrong %':>8} {'outside/h':>10}")
    for s in variants:
        m = measure(recs, s, prior)
        print(f"{s.label():58} {m['found']:6.1%} {m['in10']:6.1%} {m['in15']:6.1%} {m['latency'] or 0:6.1f}s {m['wrong_per_hour']:8.1f} {m['wrong_share']:8.1%} {m['outside_per_hour']:10.1f}", flush=True)


def clips(args) -> None:
    """One tune at a time, as the finder is mostly used: each test clip's windows in order through the decoder, from a
    fresh start. Reports how many clips get an answer, how many answers are right, and the median second of the first."""
    import onnxruntime as ort
    data = torch.load(ML / "cache" / "classifier" / "clips-v4.pt", weights_only=False, mmap=True)
    session = ort.InferenceSession(str(args.model))
    tunes = json.loads((args.model.parent / "tunes.json").read_text())
    index = {t: i for i, t in enumerate(tunes)}
    counts = popularity()
    prior = (PRIOR * np.log(np.array([counts.get(t, 0) for t in tunes], dtype=np.float32) + 1)).astype(np.float32)
    cosines = {}
    for name in ("youtube", "albums", "bands"):
        rows = [r for r in data[name] if r["tune_id"] in index]
        cosines[name] = [(index[r["tune_id"]], session.run(None, {"windows": pitchclass.keycanon(
            r["windows"].float() / (255 if r["windows"].dtype == torch.uint8 else 1)).numpy()})[0]) for r in rows]
    variants = [Settings(**json.loads(v)) for v in args.variant] if args.variant else VARIANTS
    print(f"{'variant':58} " + " ".join(f"{n + ' answered/right/at':>26}" for n in cosines))
    for s in variants:
        cells = []
        for name, rows in cosines.items():
            answered = right = 0
            at = []
            for truth, cos in rows:
                decoder = Decoder(s, prior)
                first = next(((k, t) for k, w in enumerate(cos) if (t := decoder.push(w.astype(np.float32))) is not None), None)
                if first:
                    answered += 1
                    right += first[1] == truth
                    at.append(first[0] + 8)
            cells.append(f"{answered / len(rows):8.1%} {right / max(answered, 1):7.1%} {np.median(at) if at else 0:6.1f}s")
        print(f"{s.label():58} " + " ".join(f"{c:>26}" for c in cells), flush=True)


def cadence(args) -> None:
    """Cadence (benchmark.py's cadence-run.ts harness, kept outside the repo) on the same recordings and rules: a tune
    counts as added when its name first appears in Cadence's detection list (provisional ones included), and a name
    that appears while another labelled tune plays counts as wrong even if Cadence later takes it back."""
    import subprocess
    folder = args.folder.expanduser()
    recs = recordings()
    out = folder / "out" / "sessions"
    manifest = folder / "sessions.jsonl"
    manifest.write_text("".join(json.dumps({"path": str(FULL / f"{v}.flac"), "out": str(out / f"{v}.json")}) + "\n" for v in sorted(recs)))
    subprocess.run(["npx", "-y", "tsx", "cadence-run.ts", str(manifest)], check=True, cwd=folder)
    shown = {}
    for video in recs:
        log, before = [], set()
        for t, names in json.loads((out / f"{video}.json").read_text())["shown"]:
            log += [(float(t), int(n)) for n in names if n not in before]
            before = set(names)
        shown[video] = log
    for half in ("a", "b"):
        videos = sorted(recs)[0::2] if half == "a" else sorted(recs)[1::2]
        m = measure({v: recs[v] for v in videos}, None, None, shown)
        print(f"half {half}: Cadence {m['found']:6.1%} found, {m['in10']:6.1%} ≤10 s, {m['in15']:6.1%} ≤15 s, median {m['latency'] or 0:.1f}s, "
              f"{m['wrong_per_hour']:.1f} wrong/h ({m['tunes']} tunes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    m = sub.add_parser("score")
    m.add_argument("--model", type=Path, default=MODEL, help="the finder's ONNX model (default: the web app's)")
    v = sub.add_parser("clips")
    v.add_argument("--model", type=Path, default=MODEL)
    v.add_argument("--variant", action="append", help="JSON settings; repeatable")
    a = sub.add_parser("cadence")
    a.add_argument("--folder", type=Path, default=Path("~/cadence-bench"), help="cadence-run.ts and its Cadence checkout")
    k = sub.add_parser("compare")
    k.add_argument("--half", choices=("a", "b"), help="every other video: tune on a, check on b")
    k.add_argument("--kind", choices=tuple(KINDS), default="youtube",
                   help="the YouTube session videos (clean, the numbers so far), SoundCloud pub recordings, or both")
    k.add_argument("--variant", action="append", help='JSON settings, e.g. {"history": 15}; repeatable (default: the built-in grid)')
    args = parser.parse_args()
    {"score": score, "clips": clips, "compare": compare, "cadence": cadence}[args.command](args)


if __name__ == "__main__":
    main()
