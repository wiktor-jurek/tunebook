"""Closed-set tune classifier: 8 s of pitch-class salience → one of every The Session tune.

Training data are simulated performances (tunebook_ml.simulate), made on the fly by the
DataLoader workers, so every tune of the catalog is a class. Real clips are only for
evaluation, which runs during training so the curve that matters is visible from the
start: YouTube clips (eval/youtube.csv) and band recordings of valid/test tunes.

    uv run --group train python train/classifier.py prepare                    # real-clip features, once
    uv run --group train python train/classifier.py train --name pc1 --steps 20000
    uv run --group train python train/classifier.py evaluate runs/classifier/pc1/last.pt

The head is a sub-center ArcFace: each tune has K learned centres, so a tune whose
settings differ (or that is played two ways) can occupy more than one region of the space.
"""

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

from tunebook_ml import pitchclass  # noqa: E402
from tunebook_ml.render import load_catalog  # noqa: E402
from tunebook_ml.simulate import simulate  # noqa: E402
from tunebook_ml.splits import benchmark_tunes  # noqa: E402

FRAMES = 400  # 8 s at 50 frames a second
CLIPS = ML / "cache" / "classifier" / "clips.pt"
# TUNEBOOK_RESTS=0 places simulated notes back to back (the timing before 2026-10-29's `starts`), so the
# rests change can be tested on its own (train/quick.py). Renders are fixed audio and keep their timing.
RESTS = os.environ.get("TUNEBOOK_RESTS", "1") != "0"


def cache_path(name: str) -> Path:
    """A feature cache under cache/classifier/. Height features (TUNEBOOK_FEATURES=height) keep their own
    copies, "-h" before the suffix (renders → renders-h), so the 12-channel caches are never mixed in."""
    if not pitchclass.HEIGHT:
        return ML / "cache" / "classifier" / name
    stem, dot, suffix = name.partition(".")
    return ML / "cache" / "classifier" / f"{stem}-h{dot}{suffix}"


# ── Data ────────────────────────────────────────────────────────────────────────────


class Simulated(torch.utils.data.IterableDataset):
    """Endless simulated windows: (128, FRAMES) semitone power as float16, and the tune's class."""

    _settings: list[list[dict]] | None = None

    def __init__(self, tune_ids: list[int], seed: int, backing: float = 0.6, focus: list[int] | None = None):
        self.tune_ids = tune_ids
        self.seed = seed
        self.backing = backing
        self.focus = focus  # only these classes (the paired windows of --pairs)

    @classmethod
    def settings(cls, tune_ids: list[int]) -> list[list[dict]]:
        if cls._settings is None:
            index = {tune: i for i, tune in enumerate(tune_ids)}
            grouped: list[list[dict]] = [[] for _ in tune_ids]
            for row in load_catalog():
                if row["tuneId"] in index and row["pitches"]:
                    grouped[index[row["tuneId"]]].append({k: row[k] for k in ("pitches", "durations", "starts", "kind", "meter", "mode")
                                                          if RESTS or k != "starts"})
            cls._settings = grouped
        return cls._settings

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        torch.set_num_threads(1)  # one simulator per core; library threads only fight over the CPU quota
        rng = np.random.default_rng([self.seed, info.id if info else 0])
        settings = Simulated.settings(self.tune_ids)
        while True:
            label = int(self.focus[rng.integers(len(self.focus))] if self.focus else rng.integers(len(settings)))
            if not settings[label]:
                continue
            try:
                semis = simulate(settings[label][int(rng.integers(len(settings[label])))], rng, FRAMES / pitchclass.FPS, self.backing)
            except Exception:  # an unplayable setting
                continue
            yield torch.from_numpy(semis).half(), label


def read_audio(path: Path, start: float | None = None, duration: float | None = None) -> np.ndarray:
    args = ["ffmpeg", "-v", "error"] + (["-ss", str(start)] if start else []) + ["-i", str(path)]
    args += (["-t", str(duration)] if duration else []) + ["-ac", "1", "-ar", str(pitchclass.SAMPLE_RATE), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(args, capture_output=True, check=True).stdout, dtype=np.float32)


def windows(audio: np.ndarray, hop_seconds: float = 1.0) -> torch.Tensor:
    """Pre-KeyCanon features of every 8 s window, one a second: (N, channels, FRAMES)."""
    length = FRAMES * pitchclass.HOP
    starts = range(0, max(1, len(audio) - length + 1), int(hop_seconds * pitchclass.SAMPLE_RATE))
    batch = torch.stack([torch.from_numpy(np.pad(audio[s:s + length], (0, max(0, s + length - len(audio))))) for s in starts])
    return pitchclass.features(pitchclass.semitones(batch)[:, :, :FRAMES], canon=False).half()


def found_fixes() -> dict[tuple[str, int], int | None]:
    """eval/found_fixes.csv: found sections whose label is wrong, (audio, label) → the right tune, or None
    to leave the section out (when the right tune is not one that eval set may hold)."""
    path = ML / "eval" / "found_fixes.csv"
    if not path.exists():
        return {}
    with path.open() as handle:
        return {(r["audio"], int(r["label"])): int(r["tune_id"]) if r["tune_id"] else None for r in csv.DictReader(handle)}


def prepare(destination: Path = CLIPS) -> None:
    """Features of every evaluation clip, so evaluation during training costs a forward pass."""
    sets: dict[str, list[dict]] = {"youtube": [], "sessions": [], "bands": [], "albums": []}
    trained = benchmark_tunes()[1]  # the benchmark's train half: its clips are training data (found-cache)
    with (ML / "eval" / "youtube.csv").open() as handle:
        for row in csv.DictReader(handle):
            path = ML / "cache" / "youtube" / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"
            if row["verified"] in ("yes", "") and path.exists() and int(row["tune_id"]) not in trained:
                sets["youtube"].append({"tune_id": int(row["tune_id"]), "path": path, "group": row["instrument"] or "?",
                                        "verified": row["verified"] == "yes"})
    # Tunes cut from whole pub sessions (eval/sessions.py), once their boundaries are labelled.
    sessions = ML / "eval" / "sessions.csv"
    if sessions.exists():
        with sessions.open() as handle:
            for row in csv.DictReader(handle):
                path = ML / "cache" / "youtube" / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"
                if row["verified"] == "yes" and path.exists() and int(row["tune_id"]) not in trained:
                    sets["sessions"].append({"tune_id": int(row["tune_id"]), "path": path, "group": row["set_id"], "verified": True})
    found = ML / "data" / "found" / "manifest.jsonl"
    fixes = found_fixes()
    for row in map(json.loads, found.open()):
        # valid/test tunes are the earlier "bands" set; benchmark tunes' album recordings are extra real clips.
        name = "bands" if row["split"] in ("valid", "test") else "albums" if row["split"] == "benchmark" else None
        tune = fixes.get((row["audio"], int(row["tune_id"])), int(row["tune_id"]))
        if name and tune is not None:
            sets[name].append({"tune_id": tune, "path": found.parent / row["audio"], "group": name, "verified": False})
    out: dict[str, list[dict]] = {}
    for name, rows in sets.items():
        out[name] = []
        for row in rows:
            out[name].append({**row, "path": str(row["path"]), "windows": windows(read_audio(Path(row["path"])))})
        print(f"{name}: {len(out[name])} clips")
    out.update(synthetic())
    destination.parent.mkdir(parents=True, exist_ok=True)
    torch.save(out, destination)


def found_cache() -> None:
    """Real recordings to train on (cache/classifier/found_train.pt): found sections of training-split
    tunes, and the labelled YouTube and session clips of the benchmark's train half (eval/benchmark_split.json)."""
    found = ML / "data" / "found" / "manifest.jsonl"
    rows = [{"tune_id": int(r["tune_id"]), "confidence": r["confidence"], "source": "album", "path": found.parent / r["audio"]}
            for r in map(json.loads, found.open()) if r["split"] == "train"]
    trained = benchmark_tunes()[1]
    for name, source in (("youtube.csv", "youtube"), ("sessions.csv", "session")):
        if not (ML / "eval" / name).exists():
            continue
        with (ML / "eval" / name).open() as handle:
            for row in csv.DictReader(handle):
                path = ML / "cache" / "youtube" / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"
                labelled = row["verified"] == "yes" or (source == "youtube" and row["verified"] == "")
                if labelled and row["tune_id"].isdigit() and int(row["tune_id"]) in trained and path.exists():
                    rows.append({"tune_id": int(row["tune_id"]), "confidence": 1.0 if row["verified"] == "yes" else 0.9, "source": source, "path": path})
    out = []
    for i, row in enumerate(rows):
        try:
            out.append({**{k: v for k, v in row.items() if k != "path"}, "windows": windows(read_audio(row["path"]))})
        except Exception as error:
            print(f"skip {row['path']}: {error}", flush=True)
        if i % 500 == 0:
            print(f"{i}/{len(rows)}", flush=True)
    torch.save(out, cache_path("found_train.pt"))
    sources = {s: sum(r["source"] == s for r in out) for s in ("album", "youtube", "session")}
    print(f"found_train.pt: {len(out)} recordings {sources}, {len({r['tune_id'] for r in out})} tunes, {sum(len(r['windows']) for r in out)} windows")


def synthetic(count: int = 300, seed: int = 7) -> dict[str, list[dict]]:
    """The same performances twice: simulated, and rendered with FluidSynth through the real
    front end. Accuracy on the first is what the model learnt; the drop to the second is the
    simulator's gap to audio, and the drop from there to real clips is the renderer's."""
    from tunebook_ml.performance import perform
    from tunebook_ml.render import render
    from tunebook_ml.simulate import spectrogram

    rng = np.random.default_rng(seed)
    catalog = load_catalog()
    out: dict[str, list[dict]] = {"simulated": [], "rendered": []}
    for index in rng.choice(len(catalog), count, replace=False):
        setting = catalog[int(index)]
        try:
            performance = perform(setting, rng, seconds=FRAMES / pitchclass.FPS + 0.5)
            audio = render(performance, rng)[: FRAMES * pitchclass.HOP]
        except Exception:
            continue
        semis = torch.from_numpy(spectrogram(performance, rng, FRAMES))[None]
        row = {"tune_id": setting["tuneId"], "group": "synthetic", "verified": False}
        out["simulated"].append({**row, "windows": pitchclass.features(semis, canon=False).half()})
        out["rendered"].append({**row, "windows": windows(audio)})
    return out


def _render_job(job: tuple[int, int]) -> tuple[int, np.ndarray] | None:
    """One rendered window of a random setting of tune `label`: pre-KeyCanon features, float16."""
    from tunebook_ml.performance import perform
    from tunebook_ml.render import render

    label, seed = job
    torch.set_num_threads(1)
    rng = np.random.default_rng(seed)
    settings = Simulated._settings[label]
    if not settings:
        return None
    try:
        performance = perform(settings[int(rng.integers(len(settings)))], rng, seconds=FRAMES / pitchclass.FPS + 0.5)
        # NumPy, not a tensor: torch passes tensors between processes as file descriptors and runs out
        return label, windows(render(performance, rng)[: FRAMES * pitchclass.HOP])[0].numpy()
    except Exception:
        return None


def _audio_job(job: tuple[str, float]) -> tuple[int, np.ndarray] | None:
    """Every 8 s window, one every `hop` seconds (2), of a labelled recording named {tune_id}-...: pre-KeyCanon
    salience in [0, 1] as uint8 (x255), half the size of float16 so tens of thousands of clips fit in memory."""
    path, hop = job
    torch.set_num_threads(1)
    try:
        # NumPy, not a tensor: torch passes tensors between processes as file descriptors and runs out
        pcs = windows(read_audio(Path(path)), hop_seconds=hop).float()
        return int(Path(path).name.split("-")[0]), (pcs * 255).round().to(torch.uint8).numpy()
    except Exception:
        return None


def audio_cache(args) -> None:
    """YuE2 performances (data/yue/train/*/{tune_id}-s{setting}-{n}.ogg) as one pool of windows."""
    from multiprocessing import get_context

    paths = sorted(str(p) for p in (ML / "data" / "yue" / "train").glob("*/*.ogg"))
    # spawn: torch in a forked child can deadlock on the parent's thread pool
    with get_context("spawn").Pool(args.workers) as pool:
        # --hop 8 keeps what training with --yue-stride 4 keeps (windows 8 s apart) in a quarter of the memory.
        results = [r for r in pool.imap_unordered(_audio_job, [(p, args.hop) for p in paths], chunksize=4) if r is not None]
    out = cache_path("yue.pt")
    torch.save([{"tune_id": tune, "windows": torch.from_numpy(w)} for tune, w in results], out)
    print(f"{out.name}: {len(results)} recordings, {sum(len(w) for _, w in results)} windows", flush=True)


def render_cache(args) -> None:
    """Shards of FluidSynth renders through the real front end, mixed into training to
    cover what the simulator gets wrong. Labels index catalog_tunes()."""
    from multiprocessing import Pool

    tune_ids = catalog_tunes()
    Simulated.settings(tune_ids)
    out = cache_path("renders")
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    # initializer: spawned workers (macOS) don't inherit the loaded catalog
    with Pool(args.workers, initializer=Simulated.settings, initargs=(tune_ids,)) as pool:
        for shard in range(args.shards):
            path = out / f"{args.prefix}-{shard:03d}.pt"
            if path.exists():
                continue
            # Every tune equally often: a shuffled round of all tunes per pass.
            jobs = [(int(label), int(rng.integers(2**31))) for label in rng.permutation(len(tune_ids))[: args.per_shard]]
            results = [r for r in pool.imap_unordered(_render_job, jobs, chunksize=8) if r is not None]
            torch.save({"tune_ids": tune_ids, "labels": torch.tensor([r[0] for r in results]),
                        "windows": torch.from_numpy(np.stack([r[1] for r in results]))}, path)
            print(f"{path.name}: {len(results)} windows", flush=True)


# ── Model ───────────────────────────────────────────────────────────────────────────


class Classifier(nn.Module):
    def __init__(self, n_classes: int, width: int = 384, layers: int = 8, heads: int = 6, dim: int = 384, centres: int = 3, stride: int = 4,
                 channels: int = 12):
        super().__init__()
        # Tokens are `stride` frames: 4 → 80 ms (100 tokens per window), 8 → 160 ms, about a quaver at reel tempo.
        self.stem = nn.Sequential(
            nn.Conv1d(channels, 128, 5, padding=2), nn.GELU(),
            nn.Conv1d(128, 256, 5, stride=2, padding=2), nn.GELU(),
            nn.Conv1d(256, width, 2 * (stride // 2) - 1 if stride > 2 else 3, stride=stride // 2, padding=(stride // 2) - 1 if stride > 2 else 1),
        )
        self.position = nn.Parameter(torch.zeros(1, FRAMES // stride, width))
        layer = nn.TransformerEncoderLayer(width, heads, 4 * width, dropout=0.1, activation="gelu", batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(width)
        self.attend = nn.Linear(width, 1)
        self.project = nn.Linear(2 * width, dim)
        self.centres = centres
        self.weight = nn.Parameter(torch.randn(n_classes * centres, dim) * 0.01)
        self.layerdrop = 0.0  # chance of skipping each encoder layer while training (stochastic depth)

    def embed(self, x: torch.Tensor) -> torch.Tensor:
        """(B, channels, FRAMES) KeyCanon'd features → (B, dim) unit embeddings."""
        h = self.stem(x).transpose(1, 2)
        h = h + self.position[:, : h.shape[1]]
        for layer in self.encoder.layers:
            if not (self.training and self.layerdrop and torch.rand(()).item() < self.layerdrop):
                h = layer(h)
        h = self.norm(h)
        weights = self.attend(h).softmax(dim=1)
        pooled = torch.cat([(weights * h).sum(1), h.mean(1)], dim=-1)
        return F.normalize(self.project(pooled), dim=-1)

    def cosines(self, z: torch.Tensor, classes: torch.Tensor | None = None, dims: int = 0) -> torch.Tensor:
        """(B, dim) → (B, n_classes): each tune's best centre. With `classes`, only those tunes' columns;
        with `dims`, scored in the first `dims` dimensions alone (the Matryoshka prefixes)."""
        weight = self.weight.view(-1, self.centres, self.weight.shape[1])
        if classes is not None:
            weight = weight[classes]
        if dims:
            z, weight = F.normalize(z[:, :dims], dim=-1), weight[..., :dims]
        cos = z @ F.normalize(weight.reshape(-1, weight.shape[2]), dim=-1).T
        return cos.view(len(z), -1, self.centres).max(dim=-1).values

    @torch.no_grad()
    def rotate_to_pca(self) -> None:
        """Turn the embedding space so its first dimensions are the head's main directions (uncentred
        PCA of the centres). A rotation changes no cosine; it gives Matryoshka training a start
        where the leading dimensions already carry the most."""
        w = F.normalize(self.weight.float(), dim=-1)
        _, _, vh = torch.linalg.svd(w.T @ w / len(w))
        self.project.weight.copy_(vh @ self.project.weight.float())
        self.project.bias.copy_(vh @ self.project.bias.float())
        self.weight.copy_(self.weight.float() @ vh.T)


def arcface_loss(cos: torch.Tensor, labels: torch.Tensor, scale: float, margin: float) -> torch.Tensor:
    target = cos.gather(1, labels[:, None]).clamp(-1 + 1e-6, 1 - 1e-6)
    adjusted = torch.cos(torch.acos(target) + margin)
    # Past pi - margin the angle would wrap; fall back to CosFace there, as in the ArcFace paper.
    adjusted = torch.where(target > math.cos(math.pi - margin), adjusted, target - margin * math.sin(margin))
    logits = cos.scatter(1, labels[:, None], adjusted) * scale
    return F.cross_entropy(logits, labels)


# ── Evaluation ──────────────────────────────────────────────────────────────────────


@torch.no_grad()
def evaluate(model: Classifier, tune_ids: list[int], clips: dict, device: str, scale: float, temperature: float = 1.5,
             prior: torch.Tensor | None = None, seen: set[int] | None = None, dims: tuple[int, ...] = ()) -> dict[str, float]:
    """Top-k over clips, windows combined by mean softmax; also by mean cosine, and, given `seen`
    (tunes with YuE2 audio in training), YouTube split by whether the tune had any."""
    model.eval()
    index = {tune: i for i, tune in enumerate(tune_ids)}
    metrics: dict[str, float] = {}
    for name, rows in clips.items():
        tallies: dict[str, list[int]] = {}

        def tally(key: str, ok: bool) -> None:
            tallies.setdefault(key, [0, 0])
            tallies[key][0] += int(ok)
            tallies[key][1] += 1

        for row in rows:
            if row["tune_id"] not in index:
                continue
            truth = index[row["tune_id"]]
            x = pitchclass.keycanon(row["windows"].to(device).float())
            with torch.autocast(device.split(":")[0], dtype=torch.bfloat16, enabled=device.startswith("cuda")):
                z = model.embed(x)
                cos = model.cosines(z).float()
                for d in dims:
                    tally(f"top1 meancos d{d}", int(model.cosines(z, dims=d).float().mean(0).argmax()) == truth)
            probs = (cos * scale / temperature).softmax(dim=-1).mean(0)
            if prior is not None:
                probs = probs * prior
            rank = int((probs > probs[truth]).sum()) + 1
            tally("top1", rank == 1)
            tally("top5", rank <= 5)
            tally("first8s", int(cos[0].argmax()) == truth)
            mean = cos.mean(0)
            tally("top1 meancos", int((mean > mean[truth]).sum()) == 0)
            if seen is not None and name == "youtube":
                tally("top1 yue-seen" if truth in seen else "top1 yue-unseen", rank == 1)
            if row.get("verified"):
                tally("verified top1", rank == 1)
            if name == "youtube":
                tally(f"top1 {row['group']}", rank == 1)
        for key, (hits, n) in tallies.items():
            metrics[f"{name} {key}"] = hits / max(n, 1)
    model.train()
    return metrics


@torch.no_grad()
def rerank_grid(model: Classifier, tune_ids: list[int], clips: dict, device: str, scale: float, top: int = 10,
                temperature: float = 1.5, meancos: bool = False, names: tuple[str, ...] = ("youtube", "bands", "albums")) -> dict:
    """Real-clip top-1 under every mix of the popularity prior and alignment re-ranking.

    Score for a candidate among the classifier's top `top`: log p(tune | audio) + a · log(tunebooks + 1)
    + w · alignment, where alignment (tunebook_ml.align) is the best mean cosine of the clip's
    pitch classes along a path through any of the tune's settings, in any key. With `meancos`,
    p(tune | audio) is the softmax of the windows' mean cosine (what the finder ranks by)."""
    from tunebook_ml import align

    model.eval()
    index = {tune: i for i, tune in enumerate(tune_ids)}
    counts = popularity()
    books = torch.tensor([counts.get(tune, 0) for tune in tune_ids], dtype=torch.float32, device=device)
    settings: dict[int, list[dict]] = {}
    for row in load_catalog():
        if row["pitches"]:
            settings.setdefault(row["tuneId"], []).append(row)
    priors, weights = (0.0, 0.25, 0.5, 1.0), (0.0, 2.0, 5.0, 10.0)
    grid: dict[str, dict[str, float]] = {}
    for name in names:
        rows = [r for r in clips.get(name, []) if r["tune_id"] in index]
        hits = {(a, w): [0, 0] for a in priors for w in weights}
        verified = {(a, w): [0, 0] for a in priors for w in weights}
        for row in rows:
            truth = index[row["tune_id"]]
            x = pitchclass.keycanon(row["windows"].to(device).float())
            with torch.autocast(device.split(":")[0], dtype=torch.bfloat16, enabled=device.startswith("cuda")):
                cos = model.cosines(model.embed(x)).float()
            if meancos:
                logp = (cos.mean(0) * scale / temperature).log_softmax(dim=-1)
            else:
                logp = (cos * scale / temperature).softmax(dim=-1).mean(0).clamp(min=1e-12).log()
            sequence = align.clip_sequence(row["windows"].float().numpy())
            aligned: dict[int, float] = {}
            for a in priors:
                scores = logp + a * (books + 1).log()
                candidates = scores.topk(top).indices.tolist()
                for c in candidates:
                    if c not in aligned:
                        aligned[c] = align.score(sequence, settings.get(tune_ids[c], [])[:4])
                for w in weights:
                    best = max(candidates, key=lambda c: scores[c].item() + w * aligned[c])
                    hits[(a, w)][0] += best == truth
                    hits[(a, w)][1] += 1
                    if row.get("verified"):
                        verified[(a, w)][0] += best == truth
                        verified[(a, w)][1] += 1
        print(f"── {name}: top-1 by popularity prior exponent (rows) and alignment weight (columns), {len(rows)} clips")
        print("prior  " + "".join(f"  w={w:<5}" for w in weights))
        for a in priors:
            line = "".join(f"  {hits[(a, w)][0] / max(1, hits[(a, w)][1]):6.1%} " for w in weights)
            if name == "youtube":
                line += "   verified: " + " ".join(f"{verified[(a, w)][0] / max(1, verified[(a, w)][1]):.1%}" for w in weights)
            print(f"a={a:<4} {line}")
        grid[name] = {f"a={a} w={w}": round(hits[(a, w)][0] / max(1, hits[(a, w)][1]), 4) for a in priors for w in weights}
    return grid


# ── Training ────────────────────────────────────────────────────────────────────────


def popularity() -> dict[int, int]:
    """How many The Session member tunebooks hold each tune (data/tune_popularity.csv from adactio/TheSession-data)."""
    with (ML / "data" / "tune_popularity.csv").open() as handle:
        return {int(row["tune_id"]): int(row["tunebooks"]) for row in csv.DictReader(handle)}


def catalog_tunes() -> list[int]:
    return sorted({row["tuneId"] for row in load_catalog() if row["pitches"]})


class Cached:
    """Pre-KeyCanon windows sampled into each batch: FluidSynth renders
    (cache/classifier/renders/*.pt), found recordings of training-split tunes and YuE2
    performances. Pools stay in host memory (they outgrow an 8 GB card); only each batch's
    picks go to the device."""

    def __init__(self, tune_ids: list[int], device: str, skip: set[str] = frozenset(), yue_stride: int = 1):
        self.index = {tune: i for i, tune in enumerate(tune_ids)}
        self.device = device
        self.loaded: set[str] = set()
        self.windows = {"renders": [], "found": [], "yue": []}
        self.labels = {"renders": [], "found": [], "yue": []}
        for name, file in (("found", "found_train.pt"), ("yue", "yue.pt")):
            path = cache_path(file)
            if name not in skip and path.exists():  # a skipped pool (fraction 0) would only take host memory
                for row in torch.load(path, mmap=True):  # mapped: concatenating doesn't need a second copy in memory
                    if row["tune_id"] in self.index:
                        # Windows start a second apart and overlap by 7 s, so a stride loses little and saves host memory.
                        windows = row["windows"][:: yue_stride] if name == "yue" else row["windows"]
                        self.windows[name].append(windows)
                        self.labels[name].append(torch.full((len(windows),), self.index[row["tune_id"]]))
        self.refresh()

    def refresh(self) -> None:
        """Pick up render shards written since the last call (they are produced while training runs)."""
        changed = not hasattr(self, "pools")
        for path in sorted(cache_path("renders").glob("*.pt")):
            if path.name in self.loaded:
                continue
            changed = True
            shard = torch.load(path)
            # Shard labels index the full catalog; map through tune IDs in case this run uses a subset.
            tunes = torch.tensor([self.index.get(tune, -1) for tune in shard["tune_ids"]])
            labels = tunes[shard["labels"]]
            keep = labels >= 0
            self.windows["renders"].append(shard["windows"][keep])
            self.labels["renders"].append(labels[keep])
            self.loaded.add(path.name)
        if not changed:
            return
        # Each pool is held once: its pieces are dropped once concatenated (the YuE2 pieces are slices of
        # a memory-mapped file, which would otherwise stay mapped and count against the container's
        # memory), and render shards that arrive later are appended to the pool.
        self.pools = getattr(self, "pools", {})
        for name in self.windows:
            if self.windows[name]:
                old = self.pools.pop(name, None)
                windows, labels = ([old[0]], [old[1]]) if old else ([], [])
                self.pools[name] = (torch.cat(windows + self.windows[name]), torch.cat(labels + self.labels[name]))
                self.windows[name], self.labels[name] = [], []

    def seen(self, name: str) -> set[int]:
        return set(torch.unique(self.pools[name][1]).tolist()) if name in self.pools else set()

    def size(self, name: str) -> int:
        return len(self.pools[name][1]) if name in self.pools else 0

    def sample(self, name: str, n: int) -> tuple[torch.Tensor, torch.Tensor]:
        windows, labels = self.pools[name]
        pick = torch.randint(len(labels), (n,))
        picked = windows[pick].to(self.device).float()
        if windows.dtype == torch.uint8:
            picked /= 255
        return pitchclass.keycanon(picked), labels[pick].to(self.device)

    def sample_tunes(self, name: str, labels: torch.Tensor) -> torch.Tensor:
        """One random window of each label's tune from a pool (each label must be in seen(name))."""
        windows, pool_labels = self.pools[name]
        if not hasattr(self, "_by_tune"):
            self._by_tune = {}
        if name not in self._by_tune:
            order = pool_labels.argsort()
            counts = torch.bincount(pool_labels, minlength=len(self.index))
            self._by_tune[name] = (order, counts.cumsum(0) - counts, counts)
        order, starts, counts = self._by_tune[name]
        labels = labels.cpu()
        pick = order[starts[labels] + (torch.rand(len(labels)) * counts[labels]).long()]
        picked = windows[pick].to(self.device).float()
        if windows.dtype == torch.uint8:
            picked /= 255
        return pitchclass.keycanon(picked)


def augment(x: torch.Tensor) -> torch.Tensor:
    """Feature-domain variety for cached recordings (KeyCanon'd (B, channels, FRAMES) salience), which
    otherwise reach the model unchanged every time they're drawn and get memorised: a tempo
    change, a time shift, masked spans and pitch classes, a contrast change, and a faint second
    window standing in for backing or another player."""
    b, _, frames = x.shape
    device = x.device
    # Tempo ±15%: resample along time, then crop or zero-pad back to FRAMES (one rate per call).
    rate = float(np.random.uniform(0.85, 1.15))
    stretched = F.interpolate(x, size=max(2, round(frames / rate)), mode="linear", align_corners=False)
    x = F.pad(stretched, (0, max(0, frames - stretched.shape[2])))[:, :, :frames]
    # Shift by up to a second.
    x = torch.roll(x, int(np.random.randint(-50, 51)), dims=2)
    t = torch.arange(frames, device=device)
    for _ in range(2):  # two time masks of up to 0.6 s
        start = torch.randint(frames, (b, 1), device=device)
        width = torch.randint(31, (b, 1), device=device)
        x = x * ~((t >= start) & (t < start + width))[:, None, :]
    # Drop one pitch class in a quarter of windows.
    drop = F.one_hot(torch.randint(12, (b,), device=device), 12).bool() & (torch.rand(b, 1, device=device) < 0.25)
    x = x * ~drop.repeat(1, x.shape[1] // 12)[:, :, None]  # a dropped pitch class takes its height with it
    x = x.clamp(min=0) ** torch.empty(b, 1, 1, device=device).uniform_(0.7, 1.4)
    # A faint other window in a third of the batch.
    other = x[torch.randperm(b, device=device)] * torch.empty(b, 1, 1, device=device).uniform_(0.2, 0.5)
    mix = torch.rand(b, 1, 1, device=device) < 1 / 3
    x = torch.where(mix, torch.maximum(x, other), x)
    return (x + 0.03 * torch.rand_like(x)).clamp(0, 1)


def pair_loss(real: torch.Tensor, simulated: torch.Tensor, labels: torch.Tensor, scale: float) -> torch.Tensor:
    """InfoNCE between real windows and simulated windows of the same tunes, both ways: each real
    window should be nearer its tune's simulated windows than the other tunes' in the batch. Unlike
    the head, which only learns the tunes that have real audio, this teaches the encoder the step
    from real to simulated audio, which is what simulated class centres rely on for every tune."""
    logits = real @ simulated.T * scale
    same = labels[:, None] == labels[None, :]
    loss = 0.0
    for l, positive in ((logits, same), (logits.T, same.T)):
        loss = loss + (torch.logsumexp(l, 1) - torch.logsumexp(l.masked_fill(~positive, -1e4), 1)).mean()
    return loss / 2


def train(args) -> None:
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    out = ML / "runs" / "classifier" / args.name
    out.mkdir(parents=True, exist_ok=True)
    tune_ids = catalog_tunes()
    if args.tunes:  # a subset, for quick checks that the pipeline learns at all
        tune_ids = tune_ids[: args.tunes]
    if args.tune_set:  # a fixed subset (train/quick.py tunes), kept in catalog order
        keep = set(json.loads(args.tune_set.read_text()))
        tune_ids = [tune for tune in tune_ids if tune in keep]
    Simulated.settings(tune_ids)  # load once, before workers fork
    cached = Cached(tune_ids, device, skip={name for name in ("found", "yue") if getattr(args, f"{name}_fraction") == 0 and not (name == "found" and args.pairs)}, yue_stride=args.yue_stride)
    print(f"cached windows: {cached.size('renders')} renders, {cached.size('found')} found, {cached.size('yue')} YuE2", flush=True)
    # Windows drawn from each cached pool every step. A small pool drawn from heavily is memorised,
    # not learnt from: cap each window's use at about once per --reuse-steps steps.
    draws = {name: round(min(fraction, cached.size(name) / (args.reuse_steps * args.batch)) * args.batch)
             for name, fraction in (("renders", args.render_fraction), ("found", args.found_fraction), ("yue", args.yue_fraction))}
    pairs = None
    if args.pairs:
        # Paired windows: simulated windows of tunes with found audio, each beside a real window of the same tune.
        found_tunes = sorted(cached.seen("found"))
        assert found_tunes, "--pairs needs found recordings (cache/classifier/found_train.pt)"
        pairs = iter(torch.utils.data.DataLoader(Simulated(tune_ids, args.seed + 1, args.backing, focus=found_tunes), batch_size=args.pairs,
                                                 num_workers=args.pair_workers, pin_memory=device == "cuda", persistent_workers=True, prefetch_factor=4))
        print(f"pairs: {args.pairs} real and {args.pairs} simulated windows of {len(found_tunes)} tunes, weight {args.pair_weight}", flush=True)
    # The simulator only makes the rest of each batch.
    loader = torch.utils.data.DataLoader(Simulated(tune_ids, args.seed, args.backing), batch_size=max(1, args.batch - sum(draws.values()) - 2 * args.pairs),
                                         num_workers=args.workers, pin_memory=device == "cuda", persistent_workers=True, prefetch_factor=4)
    print(f"each batch: {draws} cached, {args.batch - sum(draws.values()) - 2 * args.pairs} simulated", flush=True)
    args.channels = pitchclass.CHANNELS  # saved with the checkpoint, so loaders build the right stem
    model = Classifier(len(tune_ids), args.width, args.layers, args.heads, args.dim, args.centres, args.stride, args.channels).to(device)
    if args.init:
        # Curriculum: a backbone trained on fewer tunes. Its head is kept for those tunes
        # (catalog order is shared, so they are the first rows) and the rest start fresh.
        checkpoint = torch.load(args.init, map_location=device, weights_only=False)  # our own checkpoint; its args hold Paths
        state = checkpoint["model"]
        head = state.pop("weight")
        model.load_state_dict(state, strict=False)
        with torch.no_grad():
            if args.tune_set and "tune_ids" in checkpoint:
                # A subset (train/quick.py): take each tune's rows by tune id, not position.
                old = {tune: i for i, tune in enumerate(checkpoint["tune_ids"])}
                k = model.centres
                rows = torch.tensor([old[t] * k + j for t in tune_ids for j in range(k)], device=head.device)
                head = head[rows]
            model.weight[: len(head)] = head
        if args.freeze_head is None:
            # A fine-tune: the checkpoint already has a centre for every tune. Moving the centres
            # along with the backbone is what made YuE2 fine-tunes decline after ~1,250 steps (diag-f).
            args.freeze_head = len(head) == len(model.weight)
        if args.matryoshka:
            model.rotate_to_pca()
    if args.margin_start is None:
        args.margin_start = 0.2 * args.steps
    print(f"{len(tune_ids)} tunes, {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M parameters, device {device}, "
          f"head {'frozen' if args.freeze_head else 'trained'}", flush=True)
    # Frozen parts keep the coordinates of the checkpoint they came from: with the head frozen, new
    # audio has to be mapped onto the existing class centres instead of moving its tunes' centres.
    frozen = {"weight"} if args.freeze_head else set()
    if args.freeze_top:
        top = range(args.layers - args.freeze_top, args.layers)
        frozen |= {n for n, _ in model.named_parameters()
                   if n.split(".")[0] in ("norm", "attend", "project") or any(n.startswith(f"encoder.layers.{i}.") for i in top)}
    for n, p in model.named_parameters():
        p.requires_grad_(n not in frozen)
    trained = [(n, p) for n, p in model.named_parameters() if p.requires_grad]
    decay = [p for n, p in trained if p.dim() > 1 and n != "position"]
    other = [p for n, p in trained if p.dim() <= 1 or n == "position"]
    optimiser = torch.optim.AdamW([{"params": decay, "weight_decay": 0.05}, {"params": other, "weight_decay": 0.0}], lr=args.lr, betas=(0.9, 0.98))
    warmup = 1000

    def lr_at(step: int) -> float:
        if step < warmup:
            return args.lr * step / warmup
        return args.lr * 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(1, args.steps - warmup)))

    clips = torch.load(args.clips) if args.clips.exists() else {}
    yue_tunes = cached.seen("yue")
    model.layerdrop = args.layerdrop
    # C. Evaluate and save an exponential moving average of the weights: steadier than the last step's.
    ema = torch.optim.swa_utils.AveragedModel(model, multi_avg_fn=torch.optim.swa_utils.get_ema_multi_avg_fn(args.ema)) if args.ema else None
    log = (out / "log.jsonl").open("a")
    step, started, seen = 0, time.time(), 0
    for semis, labels in loader:
        if step >= args.steps:
            break
        for group in optimiser.param_groups:
            group["lr"] = lr_at(step)
        semis, labels = semis.to(device, non_blocking=True).float(), labels.to(device, non_blocking=True)
        with torch.no_grad():
            x = pitchclass.features(semis)
            drawn = [cached.sample(name, n) for name, n in draws.items() if n]
            if drawn:
                windows = torch.cat([w for w, _ in drawn])
                x = torch.cat([x, augment(windows) if args.augment else windows])
                labels = torch.cat([labels, *(l for _, l in drawn)])
            if pairs is not None:
                # Last in the batch: pairs simulated windows, then pairs real windows of the same tunes.
                pair_semis, pair_labels = next(pairs)
                pair_labels = pair_labels.to(device, non_blocking=True)
                real = cached.sample_tunes("found", pair_labels)
                x = torch.cat([x, pitchclass.features(pair_semis.to(device, non_blocking=True).float()), augment(real) if args.augment else real])
                labels = torch.cat([labels, pair_labels, pair_labels])
        margin = args.margin * min(1.0, max(0.0, step - args.margin_start) / (0.2 * args.steps))
        with torch.autocast(device.split(":")[0], dtype=torch.bfloat16, enabled=device == "cuda"):
            if args.sample_classes:
                # Partial FC: the batch's own tunes plus random others stand in for the whole
                # catalog, so each step is a few-thousand-way problem, which trains far more easily.
                z = model.embed(x)
                pool = [labels, torch.randint(len(tune_ids), (args.sample_classes,), device=device)]
                if args.hard_classes:
                    # Hard negatives: each window's closest tunes, the confusions worth learning.
                    with torch.no_grad():
                        pool.append(model.cosines(z.detach()).topk(args.hard_classes + 1, dim=-1).indices.flatten())
                classes = torch.unique(torch.cat(pool))
                cos = model.cosines(z, classes).float()
                targets = torch.searchsorted(classes, labels)
            else:
                z = model.embed(x)
                cos = model.cosines(z).float()
                targets = labels
        loss = arcface_loss(cos, targets, args.scale, margin)
        for d in args.matryoshka:
            # The same loss in the first d dimensions alone, so a head cut to d still works (the finder's download).
            with torch.autocast(device.split(":")[0], dtype=torch.bfloat16, enabled=device == "cuda"):
                prefix = model.cosines(z, classes if args.sample_classes else None, dims=d).float()
            loss = loss + arcface_loss(prefix, targets, args.scale, margin)
        if pairs is not None:
            aligned = pair_loss(z[-args.pairs:].float(), z[-2 * args.pairs: -args.pairs].float(), labels[-args.pairs:], args.scale)
            loss = loss + args.pair_weight * aligned
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_([p for _, p in trained], 1.0)
        optimiser.step()
        if ema is not None:
            ema.update_parameters(model)
        step += 1
        seen += len(labels)
        if step % 100 == 0:
            accuracy = (cos.argmax(-1) == targets).float().mean().item()
            record = {"step": step, "loss": round(loss.item(), 4), "train_top1": round(accuracy, 4), "lr": lr_at(step),
                      "per_second": round(seen / (time.time() - started), 1)}
            if pairs is not None:
                record["pair_loss"] = round(aligned.item(), 4)
            print(json.dumps(record), flush=True)
            log.write(json.dumps(record) + "\n")
        if step % args.eval_every == 0 or step == args.steps:
            final = ema.module if ema is not None else model
            metrics = evaluate(final, tune_ids, clips, device, args.scale, seen=yue_tunes, dims=tuple(args.matryoshka))
            record = {"step": step, **{k: round(v, 4) for k, v in sorted(metrics.items())}}
            print(json.dumps(record), flush=True)
            log.write(json.dumps(record) + "\n")
            log.flush()
            cached.refresh()
            torch.save({"model": final.state_dict(), "tune_ids": tune_ids, "args": vars(args), "step": step}, out / "last.pt")
            if args.keep:
                shutil.copy(out / "last.pt", out / f"step{step}.pt")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--out", type=Path, default=CLIPS)
    t = sub.add_parser("train")
    t.add_argument("--name", required=True)
    t.add_argument("--steps", type=int, default=20000)
    t.add_argument("--batch", type=int, default=256)
    t.add_argument("--lr", type=float, default=1e-3)
    t.add_argument("--width", type=int, default=384)
    t.add_argument("--layers", type=int, default=8)
    t.add_argument("--heads", type=int, default=6)
    t.add_argument("--dim", type=int, default=384)
    t.add_argument("--centres", type=int, default=3)
    t.add_argument("--scale", type=float, default=32.0)
    t.add_argument("--margin", type=float, default=0.2)
    t.add_argument("--backing", type=float, default=0.6)
    t.add_argument("--workers", type=int, default=10)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--eval-every", type=int, default=2000)
    t.add_argument("--tunes", type=int, default=0, help="train on the first N tunes only")
    t.add_argument("--tune-set", type=Path, help="train on the tune ids in this JSON list only (train/quick.py tunes)")
    t.add_argument("--render-fraction", type=float, default=0.3, help="share of each batch drawn from cached renders, once there are any")
    t.add_argument("--reuse-steps", type=int, default=2000, help="draw each cached window at most about once per this many steps")
    t.add_argument("--yue-fraction", type=float, default=0.2, help="share drawn from YuE2 performances")
    t.add_argument("--found-fraction", type=float, default=0.1, help="share drawn from found recordings of training-split tunes")
    t.add_argument("--pairs", type=int, default=0, help="real found windows per batch, each paired with a simulated window of its tune (pair_loss)")
    t.add_argument("--pair-weight", type=float, default=1.0, help="weight of pair_loss beside the ArcFace loss")
    t.add_argument("--pair-workers", type=int, default=3, help="simulator workers making the paired windows")
    t.add_argument("--keep", action="store_true", help="also keep a copy of the checkpoint from every eval")
    t.add_argument("--ema", type=float, default=0.999, help="decay of the weight average that is evaluated and saved (0 to disable)")
    t.add_argument("--yue-stride", type=int, default=2, help="keep every Nth YuE2 window: the pool is 3.5 GB in full, which mantis cannot spare beside a run")
    t.add_argument("--layerdrop", type=float, default=0.1, help="chance of skipping each encoder layer while training")
    t.add_argument("--hard-classes", type=int, default=8, help="each window's closest tunes added to the Partial FC sample")
    t.add_argument("--augment", type=int, default=1, help="feature-domain augmentation of cached windows (0 to disable)")
    t.add_argument("--init", help="checkpoint to start from")
    t.add_argument("--clips", type=Path, default=CLIPS, help="eval clips scored at each evaluation (classifier.py prepare --out)")
    t.add_argument("--stride", type=int, default=4, help="frames per transformer token")
    t.add_argument("--sample-classes", type=int, default=4096, help="Partial FC: random negative tunes per step (0 = all)")
    t.add_argument("--margin-start", type=int, help="step at which the ArcFace margin starts ramping in (default: 20%% of steps)")
    t.add_argument("--freeze-head", action=argparse.BooleanOptionalAction,
                   help="keep the class centres of --init fixed (default: when --init has a centre for every tune)")
    t.add_argument("--matryoshka", type=int, nargs="*", default=[],
                   help="also train the first N dimensions alone (e.g. 128 64), after turning the space to the head's PCA axes; no gain over PCA after training (PIPELINE.md §9)")
    t.add_argument("--freeze-top", type=int, default=0, help="also keep the last N encoder layers and the pooling fixed")
    sub.add_parser("found-cache")
    y = sub.add_parser("yue-cache")
    y.add_argument("--hop", type=float, default=2.0, help="seconds between windows")
    y.add_argument("--workers", type=int, default=8)
    r = sub.add_parser("render-cache")
    r.add_argument("--shards", type=int, default=12)
    r.add_argument("--per-shard", type=int, default=10000)
    r.add_argument("--workers", type=int, default=8)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--prefix", default="mac")
    e = sub.add_parser("evaluate")
    e.add_argument("checkpoint")
    e.add_argument("--prior", type=float, nargs="*", default=[0.0], help="popularity prior exponents to compare: p(tune) ∝ (tunebooks + 1) ** a")
    e.add_argument("--temperature", type=float, default=1.5)
    e.add_argument("--rerank", action="store_true", help="grid of popularity prior × alignment re-ranking instead")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.out)
    elif args.command == "found-cache":
        found_cache()
    elif args.command == "yue-cache":
        audio_cache(args)
    elif args.command == "render-cache":
        render_cache(args)
    elif args.command == "train":
        train(args)
    else:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        state = torch.load(args.checkpoint, map_location=device)
        a = state["args"]
        model = Classifier(len(state["tune_ids"]), a["width"], a["layers"], a["heads"], a["dim"], a["centres"], a.get("stride", 4), a.get("channels", 12)).to(device)
        model.load_state_dict(state["model"])
        clips = torch.load(CLIPS)
        if args.rerank:
            rerank_grid(model, state["tune_ids"], clips, device, a["scale"], temperature=args.temperature)
            return
        counts = popularity()
        books = torch.tensor([counts.get(tune, 0) for tune in state["tune_ids"]], dtype=torch.float32, device=device)
        for alpha in args.prior:
            prior = (books + 1) ** alpha if alpha else None
            print(f"── prior exponent {alpha}, temperature {args.temperature}")
            for key, value in sorted(evaluate(model, state["tune_ids"], clips, device, a["scale"], args.temperature, prior).items()):
                print(f"{key:40} {value:.1%}")


if __name__ == "__main__":
    main()
