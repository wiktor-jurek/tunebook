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

FRAMES = 400  # 8 s at 50 frames a second
CLIPS = ML / "cache" / "classifier" / "clips.pt"
REUSE_STEPS = 2000


# ── Data ────────────────────────────────────────────────────────────────────────────


class Simulated(torch.utils.data.IterableDataset):
    """Endless simulated windows: (128, FRAMES) semitone power as float16, and the tune's class."""

    _settings: list[list[dict]] | None = None

    def __init__(self, tune_ids: list[int], seed: int, backing: float = 0.6):
        self.tune_ids = tune_ids
        self.seed = seed
        self.backing = backing

    @classmethod
    def settings(cls, tune_ids: list[int]) -> list[list[dict]]:
        if cls._settings is None:
            index = {tune: i for i, tune in enumerate(tune_ids)}
            grouped: list[list[dict]] = [[] for _ in tune_ids]
            for row in load_catalog():
                if row["tuneId"] in index and row["pitches"]:
                    grouped[index[row["tuneId"]]].append({k: row[k] for k in ("pitches", "durations", "kind", "meter", "mode")})
            cls._settings = grouped
        return cls._settings

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rng = np.random.default_rng([self.seed, info.id if info else 0])
        settings = Simulated.settings(self.tune_ids)
        while True:
            label = int(rng.integers(len(settings)))
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
    """Pre-KeyCanon features of every 8 s window, one a second: (N, 12, FRAMES)."""
    length = FRAMES * pitchclass.HOP
    starts = range(0, max(1, len(audio) - length + 1), int(hop_seconds * pitchclass.SAMPLE_RATE))
    batch = torch.stack([torch.from_numpy(np.pad(audio[s:s + length], (0, max(0, s + length - len(audio))))) for s in starts])
    return pitchclass.features(pitchclass.semitones(batch)[:, :, :FRAMES], canon=False).half()


def prepare() -> None:
    """Features of every evaluation clip, so evaluation during training costs a forward pass."""
    sets: dict[str, list[dict]] = {"youtube": [], "bands": [], "albums": []}
    with (ML / "eval" / "youtube.csv").open() as handle:
        for row in csv.DictReader(handle):
            path = ML / "cache" / "youtube" / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"
            if row["verified"] in ("yes", "") and path.exists():
                sets["youtube"].append({"tune_id": int(row["tune_id"]), "path": path, "group": row["instrument"] or "?",
                                        "verified": row["verified"] == "yes"})
    found = ML / "data" / "found" / "manifest.jsonl"
    for row in map(json.loads, found.open()):
        # valid/test tunes are the earlier "bands" set; benchmark tunes' album recordings are extra real clips.
        name = "bands" if row["split"] in ("valid", "test") else "albums" if row["split"] == "benchmark" else None
        if name:
            sets[name].append({"tune_id": int(row["tune_id"]), "path": found.parent / row["audio"], "group": name, "verified": False})
    out: dict[str, list[dict]] = {}
    for name, rows in sets.items():
        out[name] = []
        for row in rows:
            out[name].append({**row, "path": str(row["path"]), "windows": windows(read_audio(Path(row["path"])))})
        print(f"{name}: {len(out[name])} clips")
    out.update(synthetic())
    CLIPS.parent.mkdir(parents=True, exist_ok=True)
    torch.save(out, CLIPS)


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


def _render_job(job: tuple[int, int]) -> tuple[int, torch.Tensor] | None:
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
        return label, windows(render(performance, rng)[: FRAMES * pitchclass.HOP])[0]
    except Exception:
        return None


def render_cache(args) -> None:
    """Shards of FluidSynth renders through the real front end, mixed into training to
    cover what the simulator gets wrong. Labels index catalog_tunes()."""
    from multiprocessing import Pool

    tune_ids = catalog_tunes()
    Simulated.settings(tune_ids)
    out = ML / "cache" / "classifier" / "renders"
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
                        "windows": torch.stack([r[1] for r in results])}, path)
            print(f"{path.name}: {len(results)} windows", flush=True)


# ── Model ───────────────────────────────────────────────────────────────────────────


class Classifier(nn.Module):
    def __init__(self, n_classes: int, width: int = 384, layers: int = 8, heads: int = 6, dim: int = 384, centres: int = 3):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv1d(12, 128, 5, padding=2), nn.GELU(),
            nn.Conv1d(128, 256, 5, stride=2, padding=2), nn.GELU(),
            nn.Conv1d(256, width, 3, stride=2, padding=1),
        )
        self.position = nn.Parameter(torch.zeros(1, FRAMES // 4, width))
        layer = nn.TransformerEncoderLayer(width, heads, 4 * width, dropout=0.1, activation="gelu", batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(width)
        self.attend = nn.Linear(width, 1)
        self.project = nn.Linear(2 * width, dim)
        self.centres = centres
        self.weight = nn.Parameter(torch.randn(n_classes * centres, dim) * 0.01)

    def embed(self, x: torch.Tensor) -> torch.Tensor:
        """(B, 12, FRAMES) KeyCanon'd features → (B, dim) unit embeddings."""
        h = self.stem(x).transpose(1, 2)
        h = self.norm(self.encoder(h + self.position[:, : h.shape[1]]))
        weights = self.attend(h).softmax(dim=1)
        pooled = torch.cat([(weights * h).sum(1), h.mean(1)], dim=-1)
        return F.normalize(self.project(pooled), dim=-1)

    def cosines(self, z: torch.Tensor, classes: torch.Tensor | None = None) -> torch.Tensor:
        """(B, dim) → (B, n_classes): each tune's best centre. With `classes`, only those tunes' columns."""
        weight = self.weight.view(-1, self.centres, self.weight.shape[1])
        if classes is not None:
            weight = weight[classes]
        cos = z @ F.normalize(weight.reshape(-1, weight.shape[2]), dim=-1).T
        return cos.view(len(z), -1, self.centres).max(dim=-1).values


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
             prior: torch.Tensor | None = None) -> dict[str, float]:
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
                cos = model.cosines(model.embed(x)).float()
            probs = (cos * scale / temperature).softmax(dim=-1).mean(0)
            if prior is not None:
                probs = probs * prior
            rank = int((probs > probs[truth]).sum()) + 1
            tally("top1", rank == 1)
            tally("top5", rank <= 5)
            tally("first8s", int(cos[0].argmax()) == truth)
            if row.get("verified"):
                tally("verified top1", rank == 1)
            if name == "youtube":
                tally(f"top1 {row['group']}", rank == 1)
        for key, (hits, n) in tallies.items():
            metrics[f"{name} {key}"] = hits / max(n, 1)
    model.train()
    return metrics


# ── Training ────────────────────────────────────────────────────────────────────────


def popularity() -> dict[int, int]:
    """How many The Session member tunebooks hold each tune (data/tune_popularity.csv from adactio/TheSession-data)."""
    with (ML / "data" / "tune_popularity.csv").open() as handle:
        return {int(row["tune_id"]): int(row["tunebooks"]) for row in csv.DictReader(handle)}


def catalog_tunes() -> list[int]:
    return sorted({row["tuneId"] for row in load_catalog() if row["pitches"]})


class Cached:
    """Pre-KeyCanon windows held on the GPU, sampled into each batch: FluidSynth renders
    (cache/classifier/renders/*.pt) and found recordings of training-split tunes."""

    def __init__(self, tune_ids: list[int], device: str):
        self.index = {tune: i for i, tune in enumerate(tune_ids)}
        self.device = device
        self.loaded: set[str] = set()
        self.windows = {"renders": [], "found": []}
        self.labels = {"renders": [], "found": []}
        found = ML / "cache" / "classifier" / "found_train.pt"
        if found.exists():
            for row in torch.load(found):
                if row["tune_id"] in self.index:
                    self.windows["found"].append(row["windows"])
                    self.labels["found"].append(torch.full((len(row["windows"]),), self.index[row["tune_id"]]))
        self.refresh()

    def refresh(self) -> None:
        """Pick up render shards written since the last call (they are produced while training runs)."""
        for path in sorted((ML / "cache" / "classifier" / "renders").glob("*.pt")):
            if path.name in self.loaded:
                continue
            shard = torch.load(path)
            # Shard labels index the full catalog; map through tune IDs in case this run uses a subset.
            tunes = torch.tensor([self.index.get(tune, -1) for tune in shard["tune_ids"]])
            labels = tunes[shard["labels"]]
            keep = labels >= 0
            self.windows["renders"].append(shard["windows"][keep])
            self.labels["renders"].append(labels[keep])
            self.loaded.add(path.name)
        self.pools = {name: (torch.cat(self.windows[name]).to(self.device), torch.cat(self.labels[name]).to(self.device))
                      for name in self.windows if self.windows[name]}

    def size(self, name: str) -> int:
        return len(self.pools[name][1]) if name in self.pools else 0

    def sample(self, name: str, n: int) -> tuple[torch.Tensor, torch.Tensor]:
        windows, labels = self.pools[name]
        pick = torch.randint(len(labels), (n,), device=self.device)
        return pitchclass.keycanon(windows[pick].float()), labels[pick]


def train(args) -> None:
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    out = ML / "runs" / "classifier" / args.name
    out.mkdir(parents=True, exist_ok=True)
    tune_ids = catalog_tunes()
    if args.tunes:  # a subset, for quick checks that the pipeline learns at all
        tune_ids = tune_ids[: args.tunes]
    Simulated.settings(tune_ids)  # load once, before workers fork
    loader = torch.utils.data.DataLoader(Simulated(tune_ids, args.seed, args.backing), batch_size=args.batch, num_workers=args.workers,
                                         pin_memory=device == "cuda", persistent_workers=True, prefetch_factor=4)
    model = Classifier(len(tune_ids), args.width, args.layers, args.heads, args.dim, args.centres).to(device)
    if args.init:
        # Curriculum: a backbone trained on fewer tunes. Its head is kept for those tunes
        # (catalog order is shared, so they are the first rows) and the rest start fresh.
        state = torch.load(args.init, map_location=device)["model"]
        head = state.pop("weight")
        model.load_state_dict(state, strict=False)
        with torch.no_grad():
            model.weight[: len(head)] = head
    if args.margin_start is None:
        args.margin_start = 0.2 * args.steps
    print(f"{len(tune_ids)} tunes, {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M parameters, device {device}", flush=True)
    decay = [p for n, p in model.named_parameters() if p.dim() > 1 and n != "position"]
    other = [p for n, p in model.named_parameters() if p.dim() <= 1 or n == "position"]
    optimiser = torch.optim.AdamW([{"params": decay, "weight_decay": 0.05}, {"params": other, "weight_decay": 0.0}], lr=args.lr, betas=(0.9, 0.98))
    warmup = 1000

    def lr_at(step: int) -> float:
        if step < warmup:
            return args.lr * step / warmup
        return args.lr * 0.5 * (1 + math.cos(math.pi * (step - warmup) / max(1, args.steps - warmup)))

    clips = torch.load(CLIPS) if CLIPS.exists() else {}
    cached = Cached(tune_ids, device)
    print(f"cached windows: {cached.size('renders')} renders, {cached.size('found')} found", flush=True)
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
            # Swap part of the simulated batch for rendered and real windows.
            at = 0
            for name, fraction in (("renders", args.render_fraction), ("found", args.found_fraction)):
                # A small pool drawn from heavily is memorised, not learnt from: cap each
                # window's use at about once per REUSE_STEPS steps until the pool grows.
                fraction = min(fraction, cached.size(name) / (REUSE_STEPS * len(labels)))
                n = int(fraction * len(labels) + torch.rand(()).item())
                if n:
                    w, l = cached.sample(name, n)
                    x[at:at + n], labels[at:at + n] = w, l
                    at += n
        margin = args.margin * min(1.0, max(0.0, step - args.margin_start) / (0.2 * args.steps))
        with torch.autocast(device.split(":")[0], dtype=torch.bfloat16, enabled=device == "cuda"):
            if args.sample_classes:
                # Partial FC: the batch's own tunes plus random others stand in for the whole
                # catalog, so each step is a few-thousand-way problem, which trains far more easily.
                classes = torch.unique(torch.cat([labels, torch.randint(len(tune_ids), (args.sample_classes,), device=device)]))
                cos = model.cosines(model.embed(x), classes).float()
                targets = torch.searchsorted(classes, labels)
            else:
                cos = model.cosines(model.embed(x)).float()
                targets = labels
        loss = arcface_loss(cos, targets, args.scale, margin)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimiser.step()
        step += 1
        seen += len(labels)
        if step % 100 == 0:
            accuracy = (cos.argmax(-1) == targets).float().mean().item()
            record = {"step": step, "loss": round(loss.item(), 4), "train_top1": round(accuracy, 4), "lr": lr_at(step),
                      "per_second": round(seen / (time.time() - started), 1)}
            print(json.dumps(record), flush=True)
            log.write(json.dumps(record) + "\n")
        if step % args.eval_every == 0 or step == args.steps:
            metrics = evaluate(model, tune_ids, clips, device, args.scale)
            record = {"step": step, **{k: round(v, 4) for k, v in sorted(metrics.items())}}
            print(json.dumps(record), flush=True)
            log.write(json.dumps(record) + "\n")
            log.flush()
            cached.refresh()
            torch.save({"model": model.state_dict(), "tune_ids": tune_ids, "args": vars(args), "step": step}, out / "last.pt")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
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
    t.add_argument("--render-fraction", type=float, default=0.3, help="share of each batch drawn from cached renders, once there are any")
    t.add_argument("--found-fraction", type=float, default=0.1, help="share drawn from found recordings of training-split tunes")
    t.add_argument("--init", help="checkpoint to start from")
    t.add_argument("--sample-classes", type=int, default=4096, help="Partial FC: random negative tunes per step (0 = all)")
    t.add_argument("--margin-start", type=int, help="step at which the ArcFace margin starts ramping in (default: 20%% of steps)")
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
    args = parser.parse_args()
    if args.command == "prepare":
        prepare()
    elif args.command == "render-cache":
        render_cache(args)
    elif args.command == "train":
        train(args)
    else:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        state = torch.load(args.checkpoint, map_location=device)
        a = state["args"]
        model = Classifier(len(state["tune_ids"]), a["width"], a["layers"], a["heads"], a["dim"], a["centres"]).to(device)
        model.load_state_dict(state["model"])
        clips = torch.load(CLIPS)
        counts = popularity()
        books = torch.tensor([counts.get(tune, 0) for tune in state["tune_ids"]], dtype=torch.float32, device=device)
        for alpha in args.prior:
            prior = (books + 1) ** alpha if alpha else None
            print(f"── prior exponent {alpha}, temperature {args.temperature}")
            for key, value in sorted(evaluate(model, state["tune_ids"], clips, device, a["scale"], args.temperature, prior).items()):
                print(f"{key:40} {value:.1%}")


if __name__ == "__main__":
    main()
