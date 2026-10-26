"""Scores a CLEWS-style embedding model on the real YouTube clips.

The catalog side is rendered: every labelled tune plus random distractor tunes gets a
few synthetic performances, embedded as overlapping 10 s segments. Each clip's first
5, 10 and 15 s is embedded the same way, and tunes are ranked by their closest pair
of segments, as Listen will rank them.

    cd ml/cache/clews && uv run --group train python ../../eval/embedding.py \
        --checkpoint ../checkpoints/dvi-clews/checkpoint_best.ckpt --conf ../checkpoints/dvi-clews/configuration.yaml
"""

import argparse
import csv
import json
import sys
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import soundfile
import torch
from omegaconf import OmegaConf

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML), str(ML / "eval"), str(Path.cwd())]

from fetch_youtube import clip_path  # noqa: E402
from models import clews  # noqa: E402

from tunebook_ml.performance import perform  # noqa: E402
from tunebook_ml.render import SAMPLE_RATE, load_catalog, render  # noqa: E402

SEGMENT, HOP = 10.0, 5.0
_settings: dict[int, list[dict]] = {}


def render_reference(job: tuple[int, int, float]) -> np.ndarray:
    tune_id, version, seconds = job
    rng = np.random.default_rng([tune_id, version, 7])
    settings = _settings[tune_id]
    for _ in range(5):
        try:
            return render(perform(settings[int(rng.integers(len(settings)))], rng, seconds=seconds), rng)[: int(seconds * SAMPLE_RATE)]
        except Exception:
            continue
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def read_mono(path: Path) -> np.ndarray:
    audio, rate = soundfile.read(path, dtype="float32", always_2d=True)
    assert rate == SAMPLE_RATE, f"{path}: {rate} Hz"
    return audio.mean(axis=1)


def load_model(checkpoint: str, conf_path: str, device: str) -> clews.Model:
    conf = OmegaConf.load(conf_path)
    model = clews.Model(conf.model, sr=SAMPLE_RATE)
    state = torch.load(checkpoint, map_location="cpu", weights_only=False)
    state = state.get("model", state.get("state_dict", state))
    state = {key.removeprefix("_forward_module.").removeprefix("module."): value for key, value in state.items()}
    missing, unexpected = model.load_state_dict(state, strict=False)
    print(f"Loaded {checkpoint}: {len(missing)} missing, {len(unexpected)} unexpected keys")
    return model.to(device).eval()


@torch.inference_mode()
def embed(model: clews.Model, audio: list[np.ndarray], device: str, batch: int = 16) -> list[torch.Tensor]:
    """Unit-normalised segment embeddings (S, C) for each waveform."""
    out = []
    for start in range(0, len(audio), batch):
        group = audio[start:start + batch]
        length = max(len(a) for a in group)
        x = torch.stack([torch.from_numpy(np.pad(a, (0, length - len(a)), mode="wrap") if len(a) < length else a) for a in group]).float().to(device)
        z = model(x, shingle_len=SEGMENT, shingle_hop=HOP)
        out += list(torch.nn.functional.normalize(z.float(), dim=-1).cpu())
    return out


@torch.no_grad()
def adapt_batchnorm(model: clews.Model, audio: list[np.ndarray], device: str, batch: int = 16) -> None:
    """AdaBN: re-estimate BatchNorm statistics on the given audio, without labels."""
    norms = [module for module in model.modules() if isinstance(module, torch.nn.modules.batchnorm._BatchNorm)]
    for module in norms:
        module.reset_running_stats()
        module.momentum = None  # cumulative average over everything seen
        module.train()
    for start in range(0, len(audio), batch):
        group = audio[start:start + batch]
        length = min(len(a) for a in group)
        x = torch.stack([torch.from_numpy(a[:length]) for a in group]).float().to(device)
        model.embed(model.prepare(x, shingle_len=SEGMENT, shingle_hop=HOP).clone())
    for module in norms:
        module.eval()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--conf", required=True)
    parser.add_argument("--distractors", type=int, default=2000)
    parser.add_argument("--renders", type=int, default=2)
    parser.add_argument("--all", action="store_true", help="include unreviewed labels (never wrong ones or sets)")
    parser.add_argument("--adapt-bn", choices=["none", "real", "mixed"], default="none",
                        help="re-estimate BatchNorm statistics on the clips' audio (no labels), or on clips plus references")
    parser.add_argument("--clips", choices=["youtube", "bands"], default="youtube",
                        help="bands: found album recordings of valid/test-split tunes, which training never sees")
    parser.add_argument("--reference-dir", help="use recorded references instead of renders: {tune_id}-{n}.wav, 16 kHz mono; "
                        "clips and candidates are then limited to those tunes")
    parser.add_argument("--render-instead", action="store_true", help="with --reference-dir: same tunes and clips, rendered references (the baseline)")
    parser.add_argument("--workers", type=int, default=8, help="render processes; each holds every SoundFont in memory")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    args = parser.parse_args()

    if args.clips == "bands":
        found = ML / "data" / "found" / "manifest.jsonl"
        rows = [{"tune_id": str(row["tune_id"]), "instrument": "band", "path": found.parent / row["audio"]}
                for row in map(json.loads, found.open()) if row["split"] in ("valid", "test")]
    else:
        with (ML / "eval" / "youtube.csv").open() as handle:
            rows = [{**row, "path": clip_path(row)} for row in csv.DictReader(handle)
                    if (row["verified"] == "yes" or (args.all and not row["verified"])) and clip_path(row).exists()]
    for row in load_catalog():
        _settings.setdefault(row["tuneId"], []).append(row)
    recorded: dict[int, list[Path]] = {}
    if args.reference_dir:
        for path in sorted([*Path(args.reference_dir).glob("*.wav"), *Path(args.reference_dir).glob("*.ogg")]):
            recorded.setdefault(int(path.stem.split("-")[0]), []).append(path)
        rows = [row for row in rows if int(row["tune_id"]) in recorded]
    rng = np.random.default_rng(1)
    labelled = sorted({int(row["tune_id"]) for row in rows if int(row["tune_id"]) in _settings})
    if recorded:
        # The reference folder fixes the candidates, so rendered and recorded runs rank the same tunes.
        candidates = sorted(set(recorded) & set(_settings))
    else:
        others = sorted(set(_settings) - set(labelled))
        candidates = labelled + [int(t) for t in rng.choice(others, min(args.distractors, len(others)), replace=False)]
    if args.render_instead:
        recorded = {}
    print(f"{len(rows)} clips, {len(candidates)} candidate tunes ({len(labelled)} labelled), {args.renders} renders each")

    if recorded:
        jobs = [(tune, version, 0.0) for tune in candidates for version in range(len(recorded.get(tune, [])))]
        references = [read_mono(recorded[tune][version]) for tune, version, _ in jobs]
        missing = sorted(set(candidates) - set(recorded))
        jobs += [(tune, version, 30.0) for tune in missing for version in range(args.renders)]
        with Pool(args.workers) as pool:
            references += pool.map(render_reference, jobs[len(references):], chunksize=8)
    else:
        jobs = [(tune, version, 30.0) for tune in candidates for version in range(args.renders)]
        with Pool(args.workers) as pool:
            references = pool.map(render_reference, jobs, chunksize=8)
    model = load_model(args.checkpoint, args.conf, args.device)
    clips = [read_mono(row["path"]) for row in rows]
    if args.adapt_bn != "none":
        # Transductive diagnostic: uses the benchmark clips' audio, never their labels.
        adapt_batchnorm(model, clips + (references[: len(clips)] if args.adapt_bn == "mixed" else []), args.device)
    reference_z = embed(model, references, args.device)
    segments = torch.cat(reference_z)  # (N, C)
    tunes = torch.tensor(sorted(candidates))
    owner = torch.searchsorted(tunes, torch.tensor([tune for (tune, _, _), z in zip(jobs, reference_z) for _ in range(len(z))]))

    results: dict[str, dict[int, list[int]]] = defaultdict(dict)
    for seconds in (5, 10, 15):
        queries = embed(model, [clip[: seconds * SAMPLE_RATE] for clip in clips], args.device)
        for row_index, q in enumerate(queries):
            # Normalised squared Euclidean distance on unit vectors is 2 - 2 cos.
            distance = (2 - 2 * q @ segments.T).min(dim=0).values
            best = torch.full((len(tunes),), float("inf")).scatter_reduce(0, owner, distance, reduce="amin")
            results[str(seconds)][row_index] = tunes[best.argsort()].tolist()

    groups: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        groups["all"].append(index)
        groups[f"instrument={row['instrument']}"].append(index)
    print(f"checkpoint={args.checkpoint} labels={'all' if args.all else 'verified'} adapt_bn={args.adapt_bn} "
          f"references={'renders' if not recorded else args.reference_dir}")
    for name, members in sorted(groups.items(), key=lambda item: (item[0] != "all", item[0])):
        line = f"{name:28} n={len(members):4d}"
        for seconds in ("5", "10", "15"):
            ranks = [results[seconds][i].index(int(rows[i]["tune_id"])) + 1 if int(rows[i]["tune_id"]) in results[seconds][i] else 10**6 for i in members]
            line += f"  top1@{seconds}s={np.mean([r == 1 for r in ranks]):.1%} top5@{seconds}s={np.mean([r <= 5 for r in ranks]):.1%}"
        print(line)


if __name__ == "__main__":
    main()
