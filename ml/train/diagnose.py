"""Why does the YuE2 fine-tune peak early? Evaluation-only diagnostics of classifier checkpoints.

    python train/diagnose.py sweep BASE CKPT... --reference cache/classifier/clips-v1.pt
    python train/diagnose.py detail BASE CKPT

`sweep` scores weight interpolations (1 - a) BASE + a CKPT (WiSE-FT) on the real clips. YouTube
clips that are not in the --reference clip file (the ones step counts were chosen on) are
reported separately as "holdout".

`compare A B...` scores checkpoints on the same clips with bootstrap intervals and exact McNemar
tests against A. `rerank CKPT` runs the popularity prior × alignment grid and recall@K. `errors
CKPT` sorts wrong answers by tune type, melodic overlap with the truth and the truth's rank.
`prototypes CKPT` replaces the learned head with means of simulated windows' embeddings, per
tune and per position in the tune. A checkpoint written PATH@k1 is loaded with one centre per tune.

`detail` compares BASE and CKPT on:
- centres: which of a tune's sub-centres wins for simulated, rendered, YuE2 and real windows,
  and how far each centre moved from BASE. Tests the idea that YuE2-seen tunes grow a centre
  for YuE2/real audio that real recordings of other tunes then fall onto.
- stealers: for wrong answers on real clips, whether the winning tune had YuE2 audio.
- keys: how often KeyCanon's rotation changes between neighbouring windows, and top-1 when
  each window is also scored at other rotations (key test-time augmentation).
- k1: top-1 with one centre per tune, to see what the 3-centre head is worth.
"""

import argparse
import copy
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import classifier as c  # noqa: E402
from export_finder import load  # noqa: E402
from tunebook_ml import pitchclass  # noqa: E402
from tunebook_ml.simulate import simulate  # noqa: E402

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
REAL = ("youtube", "holdout", "bands", "albums")


def report(out, record: dict) -> None:
    print(json.dumps(record), flush=True)
    out.write(json.dumps(record) + "\n")
    out.flush()


def real_clips(path: Path, reference: Path | None) -> dict[str, list[dict]]:
    """The real clip sets, with YouTube clips missing from `reference` moved to "holdout"."""
    clips = torch.load(path)
    out = {name: clips.get(name, []) for name in ("youtube", "sessions", "bands", "albums")}
    if reference:
        chosen = {row["path"] for row in torch.load(reference)["youtube"]}
        out["holdout"] = [row for row in out["youtube"] if row["path"] not in chosen]
        out["youtube"] = [row for row in out["youtube"] if row["path"] in chosen]
    return out


def blend(base: c.Classifier, model: c.Classifier, alpha: float) -> c.Classifier:
    mixed = copy.deepcopy(model)
    other = base.state_dict()
    mixed.load_state_dict({k: (1 - alpha) * other[k].float() + alpha * v.float() for k, v in model.state_dict().items()})
    return mixed.eval()


@torch.no_grad()
def embed(model: c.Classifier, windows: torch.Tensor, extra: int = 0, batch: int = 512) -> torch.Tensor:
    """Pre-KeyCanon windows (float or uint8 × 255) → (N, dim) embeddings, rotated `extra` past canonical."""
    out = []
    for i in range(0, len(windows), batch):
        x = windows[i:i + batch].to(DEVICE).float()
        if windows.dtype == torch.uint8:
            x /= 255
        with torch.autocast("cuda", dtype=torch.bfloat16, enabled=DEVICE == "cuda"):
            out.append(model.embed(pitchclass.keycanon(x, extra)).float())
    return torch.cat(out)


def centres(model: c.Classifier) -> torch.Tensor:
    """(tunes, K, dim) unit sub-centres."""
    return F.normalize(model.weight.detach().float().view(-1, model.centres, model.weight.shape[1]), dim=-1)


def meancos_top1(model: c.Classifier, rows: list[dict], index: dict[int, int]) -> float:
    return float((per_clip(model, rows, index)[0] == 1).mean()) if rows else 0.0


@torch.no_grad()
def per_clip(model: c.Classifier, rows: list[dict], index: dict[int, int], scores=None) -> tuple[np.ndarray, np.ndarray]:
    """For each clip, the true tune's rank (1 = right) by the windows' mean cosine, and the winning
    tune's index. `scores` maps (N, dim) embeddings to (N, tunes) in place of the model's head."""
    ranks, winners = [], []
    for row in rows:
        z = embed(model, row["windows"])
        mean = (scores(z) if scores else model.cosines(z)).mean(0)
        truth = index[row["tune_id"]]
        ranks.append(int((mean > mean[truth]).sum()) + 1)
        winners.append(int(mean.argmax()))
    return np.array(ranks), np.array(winners)


def interval(hits: np.ndarray, resamples: int = 2000) -> list[float]:
    """95% bootstrap interval of a hit rate."""
    if len(hits) == 0:
        return [0.0, 0.0]
    rng = np.random.default_rng(0)
    means = hits[rng.integers(len(hits), size=(resamples, len(hits)))].mean(1)
    return [round(float(np.quantile(means, 0.025)), 4), round(float(np.quantile(means, 0.975)), 4)]


def mcnemar(a: np.ndarray, b: np.ndarray) -> dict:
    """Exact McNemar test of two models' hits on the same clips: a two-sided binomial test on the
    clips only one of them gets right."""
    only_a, only_b = int((a & ~b).sum()), int((~a & b).sum())
    n, k = only_a + only_b, min(only_a, only_b)
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0
    return {"only first": only_a, "only second": only_b, "p": round(p, 4)}


def load_spec(spec: str) -> tuple[c.Classifier, dict]:
    path, _, variant = spec.partition("@")
    model, ckpt = load(path, one_centre=variant == "k1")
    return model.to(DEVICE), ckpt


def sweep(args) -> None:
    base, ckpt = load(args.base)
    base = base.to(DEVICE)
    index = {tune: i for i, tune in enumerate(ckpt["tune_ids"])}
    clips = {name: [r for r in rows if r["tune_id"] in index] for name, rows in real_clips(args.clips, args.reference).items()}
    with args.out.open("a") as out:
        report(out, {"sweep": "clips", **{name: len(rows) for name, rows in clips.items()}})
        for path in args.checkpoints:
            model = load(path)[0].to(DEVICE)
            for alpha in args.alphas:
                mixed = blend(base, model, alpha) if alpha < 1 else model
                metrics = c.evaluate(mixed, ckpt["tune_ids"], clips, DEVICE, ckpt["args"]["scale"])
                keep = {k: round(v, 4) for k, v in sorted(metrics.items())
                        if k.split(" ", 1)[1] in ("top1", "top1 meancos", "top5", "verified top1")}
                report(out, {"checkpoint": path, "alpha": alpha, **keep})


# ── detail ──────────────────────────────────────────────────────────────────────────


def windows_by_tune(rows: list[dict], tunes: set[int], per_tune: int, rng: np.random.Generator) -> dict[int, torch.Tensor]:
    """Up to `per_tune` windows of each wanted tune from rows of {"tune_id", "windows"}."""
    grouped: dict[int, list[torch.Tensor]] = {}
    for row in rows:
        if row["tune_id"] in tunes:
            grouped.setdefault(row["tune_id"], []).append(row["windows"])
    out = {}
    for tune, parts in grouped.items():
        stacked = torch.cat(parts)
        out[tune] = stacked[torch.from_numpy(rng.choice(len(stacked), min(per_tune, len(stacked)), replace=False))]
    return out


def simulated(tune_ids: list[int], tunes: list[int], per_tune: int, rng: np.random.Generator) -> dict[int, torch.Tensor]:
    settings = c.Simulated.settings(tune_ids)
    index = {tune: i for i, tune in enumerate(tune_ids)}
    out = {}
    for tune in tunes:
        made = []
        for _ in range(per_tune * 3):
            if len(made) == per_tune:
                break
            choices = settings[index[tune]]
            try:
                semis = simulate(choices[int(rng.integers(len(choices)))], rng, c.FRAMES / pitchclass.FPS, 0.6)
            except Exception:
                continue
            made.append(pitchclass.features(torch.from_numpy(semis)[None].float(), canon=False)[0])
        if made:
            out[tune] = torch.stack(made)
    return out


def winning_centre(model: c.Classifier, windows: torch.Tensor, label: int) -> tuple[torch.Tensor, torch.Tensor]:
    """For each window, the index of the true tune's best centre and its cosine."""
    cos = embed(model, windows) @ centres(model)[label].T  # (N, K)
    best = cos.max(dim=1)
    return best.indices.cpu(), best.values.cpu()


def centre_report(model: c.Classifier, base: c.Classifier, sources: dict[str, dict[int, torch.Tensor]],
                  index: dict[int, int], yue_tunes: set[int]) -> dict:
    """Per source: mean true-tune cosine and the dominant centre of each tune. Then how often
    two sources pick the same dominant centre, and how far each kind of centre moved from base."""
    dominant: dict[str, dict[int, int]] = {}
    result: dict = {}
    for name, by_tune in sources.items():
        dominant[name], values = {}, []
        for tune, windows in by_tune.items():
            picks, cos = winning_centre(model, windows, index[tune])
            dominant[name][tune] = Counter(picks.tolist()).most_common(1)[0][0]
            values.append(cos.mean().item())
        result[f"cos {name}"] = round(float(np.mean(values)), 4)

    def agree(a: str, b: str, tunes: set[int] | None = None) -> float | None:
        shared = [t for t in dominant[a] if t in dominant[b] and (tunes is None or t in tunes)]
        return round(float(np.mean([dominant[a][t] == dominant[b][t] for t in shared])), 3) if shared else None

    unseen = set(index) - yue_tunes
    result["same centre sim/render"] = agree("sim", "render")
    result["same centre sim/yue"] = agree("sim", "yue")
    result["same centre render/yue"] = agree("render", "yue")
    for name in REAL:
        if name in dominant:
            result[f"same centre sim/{name} (yue-seen)"] = agree("sim", name, yue_tunes)
            result[f"same centre sim/{name} (unseen)"] = agree("sim", name, unseen)
            result[f"same centre yue/{name}"] = agree("yue", name)
    now, before = centres(model), centres(base)
    drift = (now * before).sum(-1)  # (tunes, K) cosine of each centre to where it started
    within = (now @ now.transpose(1, 2)).triu(1)  # pairwise cosines between a tune's own centres
    k = now.shape[1]
    result["centre-centre cos"] = round(within.sum().item() / (len(now) * k * (k - 1) / 2), 4)
    yue_centre = [(index[t], dominant["yue"][t]) for t in dominant["yue"]]
    sim_centre = [(index[t], dominant["sim"][t]) for t in dominant["sim"] if t in yue_tunes and t in dominant["yue"]
                  and dominant["sim"][t] != dominant["yue"][t]]
    unseen_rows = torch.tensor([index[t] for t in unseen])
    result["drift yue-dominant centre"] = round(float(np.mean([drift[i, j].item() for i, j in yue_centre])), 4)
    result["drift sim-dominant centre, yue-seen, differs"] = round(float(np.mean([drift[i, j].item() for i, j in sim_centre])), 4) if sim_centre else None
    result["drift unseen tunes"] = round(drift[unseen_rows].mean().item(), 4)
    return result


def stealers(model: c.Classifier, clips: dict[str, list[dict]], index: dict[int, int], tune_ids: list[int],
             yue_tunes: set[int]) -> dict:
    """Wrong mean-cosine answers on real clips: is the winner a tune with YuE2 audio, and by how much does it win?"""
    wrong, winner_seen, gaps, truth_cos = 0, 0, [], []
    total = 0
    for name in ("youtube", "holdout"):
        for row in clips.get(name, []):
            mean = model.cosines(embed(model, row["windows"])).mean(0)
            truth = index[row["tune_id"]]
            truth_cos.append(mean[truth].item())
            total += 1
            winner = int(mean.argmax())
            if winner != truth:
                wrong += 1
                winner_seen += tune_ids[winner] in yue_tunes
                gaps.append((mean[winner] - mean[truth]).item())
    return {"clips": total, "wrong": wrong, "winner yue-seen": round(winner_seen / max(1, wrong), 3),
            "yue-seen share of catalog": round(len(yue_tunes) / len(tune_ids), 3),
            "mean truth cos": round(float(np.mean(truth_cos)), 4), "mean wrong gap": round(float(np.mean(gaps)), 4) if gaps else None}


def keys(model: c.Classifier, clips: dict[str, list[dict]], index: dict[int, int]) -> dict:
    """KeyCanon stability between neighbouring windows, and top-1 when windows are also scored at other rotations."""
    changes, pairs, deltas = 0, 0, Counter()
    variants = {"0": [0], "0,±1": [0, 1, 11], "0,±1,±2": [0, 1, 2, 10, 11], "0,5,7": [0, 5, 7], "all 12": list(range(12))}
    hits = {f"{v} {how}": 0 for v in variants for how in ("max", "mean")}
    unstable_hits, unstable_n, stable_hits, stable_n = 0, 0, 0, 0
    n = 0
    for name in ("youtube", "holdout"):
        for row in clips.get(name, []):
            x = row["windows"].to(DEVICE).float()
            shift = pitchclass.key_shift(x).cpu()
            moved = (shift[1:] != shift[:-1])
            changes += int(moved.sum())
            pairs += len(moved)
            deltas.update((((shift[1:] - shift[:-1]) + 5) % 12 - 5)[moved].tolist())
            by_shift = torch.stack([model.cosines(embed(model, row["windows"], extra)) for extra in range(12)])  # (12, N, tunes)
            truth = index[row["tune_id"]]
            for v, extras in variants.items():
                part = by_shift[extras]
                for how, combined in (("max", part.max(0).values), ("mean", part.mean(0))):
                    hits[f"{v} {how}"] += int(combined.mean(0).argmax()) == truth
            ok = int(by_shift[0].mean(0).argmax()) == truth
            if moved.float().mean() > 0.2:
                unstable_hits, unstable_n = unstable_hits + ok, unstable_n + 1
            else:
                stable_hits, stable_n = stable_hits + ok, stable_n + 1
            n += 1
    return {"rotation changes between neighbours": round(changes / max(1, pairs), 3),
            "change sizes": dict(sorted(Counter({int(k): v for k, v in deltas.items()}).items())),
            "top1 clips with >20% changes": f"{unstable_hits}/{unstable_n}", "top1 other clips": f"{stable_hits}/{stable_n}",
            **{f"top1 key-tta {k}": round(v / max(1, n), 4) for k, v in hits.items()}}


def single_centre(model: c.Classifier, usage: torch.Tensor, how: str) -> c.Classifier:
    """The model with one centre per tune: the most used one, or the normalised mean of all."""
    one = copy.deepcopy(model)
    now = centres(model)
    picked = now[torch.arange(len(now)), usage.argmax(1).to(now.device)] if how == "most used" else F.normalize(now.mean(1), dim=-1)
    one.centres = 1
    one.weight = nn.Parameter(picked.to(model.weight.dtype))
    return one.eval()


@torch.no_grad()
def detail(args) -> None:
    base, ckpt = load(args.base)
    model, state = load(args.checkpoint)
    base, model = base.to(DEVICE), model.to(DEVICE)
    tune_ids = state["tune_ids"]
    index = {tune: i for i, tune in enumerate(tune_ids)}
    rng = np.random.default_rng(0)
    clips = {name: [r for r in rows if r["tune_id"] in index] for name, rows in real_clips(args.clips, args.reference).items()}
    yue_rows = torch.load(c.cache_path("yue.pt"), mmap=True)
    yue_tunes = {row["tune_id"] for row in yue_rows}
    renders = [torch.load(p) for p in sorted(c.cache_path("renders").glob("*.pt"))]
    render_rows = [{"tune_id": shard["tune_ids"][int(label)], "windows": shard["windows"][i:i + 1]}
                   for shard in renders for i, label in enumerate(shard["labels"])]

    real_tunes = {row["tune_id"] for rows in clips.values() for row in rows}
    seen_list = sorted(yue_tunes & set(index))
    wanted = sorted(set(rng.choice(seen_list, args.tunes, replace=False).tolist()) | real_tunes)
    print(f"{len(wanted)} tunes: {args.tunes} random YuE2-seen and {len(real_tunes)} with real clips", flush=True)
    sources = {
        "sim": simulated(tune_ids, wanted, args.per_tune, rng),
        "render": windows_by_tune(render_rows, set(wanted), args.per_tune, rng),
        "yue": windows_by_tune(yue_rows, set(wanted), args.per_tune, rng),
        **{name: windows_by_tune(rows, set(wanted), 10_000, rng) for name, rows in clips.items()},
    }

    # Every render and a sample of YuE2 windows, to count how often each centre wins (for the one-centre head).
    sample = [int(i) for i in rng.choice(len(yue_rows), min(len(yue_rows), args.yue_recordings), replace=False)
              if yue_rows[int(i)]["tune_id"] in index]
    pools = [(torch.cat([shard["windows"] for shard in renders]),
              torch.cat([torch.tensor([index[t] for t in shard["tune_ids"]])[shard["labels"]] for shard in renders])),
             (torch.cat([yue_rows[i]["windows"] for i in sample]),
              torch.cat([torch.full((len(yue_rows[i]["windows"]),), index[yue_rows[i]["tune_id"]]) for i in sample]))]
    with args.out.open("a") as out:
        for label, m in (("base", base), ("checkpoint", model)):
            tag = {"model": args.base if label == "base" else args.checkpoint}
            report(out, {**tag, "centres": centre_report(m, base, sources, index, yue_tunes)})
            report(out, {**tag, "stealers": stealers(m, clips, index, tune_ids, yue_tunes)})
            report(out, {**tag, "keys": keys(m, clips, index)})
            usage = torch.zeros(len(tune_ids), m.centres)
            all_centres = centres(m)
            for windows, labels in pools:
                for i in range(0, len(windows), 4096):
                    z = embed(m, windows[i:i + 4096])
                    lab = labels[i:i + 4096]
                    picks = torch.einsum("bd,bkd->bk", z, all_centres[lab.to(DEVICE)]).argmax(1).cpu()
                    usage.index_put_((lab, picks), torch.ones(len(lab)), accumulate=True)
            k1 = {}
            for how in ("most used", "mean"):
                one = single_centre(m, usage, how)
                for name in ("youtube", "holdout", "bands", "albums"):
                    if clips.get(name):
                        k1[f"{name} {how}"] = round(meancos_top1(one, clips[name], index), 4)
            for name in ("youtube", "holdout", "bands", "albums"):
                if clips.get(name):
                    k1[f"{name} K={m.centres}"] = round(meancos_top1(m, clips[name], index), 4)
            report(out, {**tag, "k1": k1, "unused centres": round((usage == 0).float().mean().item(), 3)})


# ── compare, rerank, errors, prototypes ─────────────────────────────────────────────


def clip_sets(args, tune_ids: list[int]) -> dict[str, list[dict]]:
    index = set(tune_ids)
    return {name: [r for r in rows if r["tune_id"] in index] for name, rows in real_clips(args.clips, args.reference).items() if rows}


def compare(args) -> None:
    """Top-1 of each model with intervals, and McNemar tests of each against the first."""
    first, ckpt = load_spec(args.models[0])
    index = {tune: i for i, tune in enumerate(ckpt["tune_ids"])}
    clips = clip_sets(args, ckpt["tune_ids"])
    hits = {args.models[0]: {name: per_clip(first, rows, index)[0] == 1 for name, rows in clips.items()}}
    for spec in args.models[1:]:
        model = load_spec(spec)[0]
        hits[spec] = {name: per_clip(model, rows, index)[0] == 1 for name, rows in clips.items()}
    with args.out.open("a") as out:
        for name in clips:
            record = {"compare": name, "clips": len(clips[name])}
            for spec, by_set in hits.items():
                record[spec] = {"top1": round(float(by_set[name].mean()), 4), "interval": interval(by_set[name])}
                if spec != args.models[0]:
                    record[spec]["vs first"] = mcnemar(hits[args.models[0]][name], by_set[name])
            report(out, record)


def rerank(args) -> None:
    """Recall@K of the classifier's shortlist, then the popularity prior × alignment grid."""
    model, ckpt = load_spec(args.checkpoint)
    index = {tune: i for i, tune in enumerate(ckpt["tune_ids"])}
    clips = clip_sets(args, ckpt["tune_ids"])
    with args.out.open("a") as out:
        for name, rows in clips.items():
            ranks = per_clip(model, rows, index)[0]
            report(out, {"recall": name, "checkpoint": args.checkpoint, "clips": len(rows),
                         **{f"@{k}": [round(float((ranks <= k).mean()), 4), interval(ranks <= k)] for k in (1, 5, 10, 20, 50)}})
        grid = c.rerank_grid(model, ckpt["tune_ids"], clips, DEVICE, ckpt["args"]["scale"], top=args.top,
                             meancos=True, names=tuple(clips))
        report(out, {"rerank": args.checkpoint, "top": args.top, **grid})


def interval_grams(pitches: list[int], n: int = 6) -> set[tuple[int, ...]]:
    """The melody's runs of n successive pitch intervals: unchanged by transposition."""
    steps = np.diff(pitches).tolist()
    return {tuple(steps[i:i + n]) for i in range(len(steps) - n + 1)}


def containment(a: set, b: set) -> float:
    return len(a & b) / max(1, min(len(a), len(b)))


def errors(args) -> None:
    """What the wrong answers have in common with the truth: tune type, shared melody, how far down the truth was."""
    model, ckpt = load_spec(args.checkpoint)
    tune_ids = ckpt["tune_ids"]
    index = {tune: i for i, tune in enumerate(tune_ids)}
    grams: dict[int, set] = {}
    kinds: dict[int, str] = {}
    for row in c.load_catalog():
        if row["pitches"]:
            grams.setdefault(row["tuneId"], set()).update(interval_grams(row["pitches"]))
            kinds.setdefault(row["tuneId"], (row.get("kind") or "?").lower())
    # What chance looks like: random pairs of tunes of the same type.
    rng = np.random.default_rng(0)
    by_kind: dict[str, list[int]] = {}
    for tune, kind in kinds.items():
        by_kind.setdefault(kind, []).append(tune)
    common = [k for k, v in by_kind.items() if len(v) > 100]
    baseline = []
    for _ in range(2000):
        pool = by_kind[common[int(rng.integers(len(common)))]]
        a, b = rng.choice(pool, 2, replace=False)
        baseline.append(containment(grams[int(a)], grams[int(b)]))
    baseline = np.array(baseline)
    clips = clip_sets(args, tune_ids)
    with args.out.open("a") as out:
        report(out, {"errors": "baseline", "same-type random pairs": len(baseline),
                     **{f"overlap >= {t}": round(float((baseline >= t).mean()), 4) for t in (0.15, 0.3, 0.5)},
                     "median": round(float(np.median(baseline)), 4)})
        for name, rows in clips.items():
            ranks, winners = per_clip(model, rows, index)
            tally: Counter = Counter()
            pairs = []
            for row, rank, winner in zip(rows, ranks, winners):
                if rank == 1:
                    continue
                truth, other = row["tune_id"], tune_ids[winner]
                overlap = containment(grams.get(truth, set()), grams.get(other, set()))
                melody = "near-identical" if overlap >= 0.5 else "shares material" if overlap >= 0.15 else "unrelated"
                tally[melody] += 1
                tally["same type" if kinds.get(truth) == kinds.get(other) else "different type"] += 1
                tally["truth rank " + ("2-5" if rank <= 5 else "6-20" if rank <= 20 else "21-50" if rank <= 50 else ">50")] += 1
                if melody == "near-identical":
                    pairs.append([truth, other, round(overlap, 3)])
            report(out, {"errors": name, "checkpoint": args.checkpoint, "clips": len(rows), "wrong": int((ranks > 1).sum()),
                         **dict(sorted(tally.items())), "near-identical pairs (truth, winner, overlap)": pairs})


def _prototype_job(job: tuple[int, int, int, int]) -> tuple[int, np.ndarray, np.ndarray] | None:
    """`count` simulated windows of tune `label` (pre-KeyCanon, float16) and which of `parts` equal
    stretches of the tune each starts in. Mirrors tunebook_ml.simulate.simulate, keeping the start."""
    from tunebook_ml.performance import perform
    from tunebook_ml.simulate import rests, spectrogram

    label, seed, count, parts = job
    torch.set_num_threads(1)
    rng = np.random.default_rng(seed)
    settings = c.Simulated._settings[label]
    if not settings:
        return None
    windows, buckets = [], []
    for _ in range(count * 2):
        if len(windows) == count:
            break
        setting = settings[int(rng.integers(len(settings)))]
        try:
            performance = perform(setting, rng, seconds=c.FRAMES / pitchclass.FPS + 0.5)
            rests(performance, rng)
            semis = spectrogram(performance, rng, c.FRAMES)
        except Exception:
            continue
        windows.append(pitchclass.features(torch.from_numpy(semis)[None].float(), canon=False)[0].half().numpy())
        buckets.append(min(parts - 1, parts * performance.start // len(setting["pitches"])))
    # NumPy, not tensors: torch passes tensors between processes as file descriptors and runs out
    return (label, np.array(buckets), np.stack(windows)) if windows else None


@torch.no_grad()
def prototypes(args) -> None:
    """Class centres from simulated audio instead of the learned head: (a) the learned head,
    (b) the mean embedding of each tune's simulated windows, (c) one mean per part of the tune
    (--parts, eighths by default), scoring a window by its tune's best part, (d) (a) and (b)
    averaged, (e) the learned head for tunes with YuE2 audio and (b) for the rest. With --save,
    the centres are kept for export_finder.py --sim-centres."""
    from multiprocessing import Pool

    path, _, variant = args.checkpoint.partition("@")
    model, ckpt = load(path, one_centre=variant == "k1")  # on the CPU until the workers have forked
    tune_ids = ckpt["tune_ids"]
    index = {tune: i for i, tune in enumerate(tune_ids)}
    c.Simulated.settings(tune_ids)
    rng = np.random.default_rng(args.seed)
    jobs = [(label, int(rng.integers(2**31)), args.per_tune, args.parts) for label in range(len(tune_ids))]
    buffer: list[tuple[int, np.ndarray, np.ndarray]] = []

    def flush() -> None:
        labels = torch.tensor(np.concatenate([np.full(len(b), l) for l, b, _ in buffer]), device=DEVICE)
        buckets = torch.tensor(np.concatenate([b for _, b, _ in buffer]), device=DEVICE)
        z = embed(model, torch.from_numpy(np.concatenate([w for _, _, w in buffer])))
        flat = labels * args.parts + buckets
        sums.view(-1, dim).index_add_(0, flat, z)
        counts.view(-1).index_add_(0, flat, torch.ones(len(flat), device=DEVICE))
        buffer.clear()

    started = time.time()
    with Pool(args.workers, initializer=c.Simulated.settings, initargs=(tune_ids,)) as pool:
        model = model.to(DEVICE)
        dim = model.weight.shape[1]
        sums = torch.zeros(len(tune_ids), args.parts, dim, device=DEVICE)
        counts = torch.zeros(len(tune_ids), args.parts, device=DEVICE)
        for done, result in enumerate(pool.imap_unordered(_prototype_job, jobs, chunksize=16), 1):
            if result is not None:
                buffer.append(result)
            if sum(len(b) for _, b, _ in buffer) >= 4096:
                flush()
            if done % 2000 == 0:
                print(f"{done}/{len(jobs)} tunes, {time.time() - started:.0f} s", flush=True)
    if buffer:
        flush()
    per_tune = F.normalize(sums.sum(1), dim=-1)
    per_bucket = F.normalize(sums, dim=-1)
    empty = counts == 0
    head = centres(model)[:, 0]
    seen = {row["tune_id"] for row in torch.load(c.cache_path("yue.pt"), mmap=True)}
    has_yue = torch.tensor([tune in seen for tune in tune_ids], device=DEVICE)
    hybrid = torch.where(has_yue[:, None], head, per_tune)
    if args.save:
        torch.save({"tune_ids": tune_ids, "checkpoint": args.checkpoint, "per_tune": per_tune.cpu(), "per_eighth": per_bucket.cpu(),  # per part; the name predates --parts
                    "counts": counts.cpu(), "has_yue": has_yue.cpu()}, args.save)

    def by_bucket(z: torch.Tensor, centres: torch.Tensor = per_bucket, missing: torch.Tensor = empty) -> torch.Tensor:
        cos = torch.einsum("nd,tbd->ntb", z, centres).masked_fill(missing[None], -1.0)
        return cos.max(-1).values

    methods = {"a learned head": lambda z: z @ head.T, "b sim mean": lambda z: z @ per_tune.T,
               f"c sim per part ({args.parts})": by_bucket, "d head+sim": lambda z: (z @ head.T + z @ per_tune.T) / 2,
               "e hybrid": lambda z: z @ hybrid.T}
    if args.parts > 8:
        # The same windows in eighths (neighbouring parts merged), to separate more windows from finer parts.
        group = args.parts // 8
        merged = F.normalize(sums.view(len(tune_ids), 8, group, -1).sum(2), dim=-1)
        merged_empty = counts.view(len(tune_ids), 8, group).sum(2) == 0
        methods["c sim per part (8, merged)"] = lambda z: by_bucket(z, merged, merged_empty)
    clips = clip_sets(args, tune_ids)
    with args.out.open("a") as out:
        report(out, {"prototypes": args.checkpoint, "per tune": args.per_tune, "parts": args.parts, "windows": int(counts.sum()),
                     "empty parts": round(float(empty.float().mean()), 4), "seconds": round(time.time() - started)})
        for name, rows in clips.items():
            hits = {m: per_clip(model, rows, index, f)[0] == 1 for m, f in methods.items()}
            yue = np.array([row["tune_id"] in seen for row in rows])
            record = {"prototypes": name, "clips": len(rows), "yue-seen clips": int(yue.sum())}
            for m, h in hits.items():
                record[m] = {"top1": round(float(h.mean()), 4), "interval": interval(h),
                             "yue-seen": round(float(h[yue].mean()), 4) if yue.any() else None,
                             "unseen": round(float(h[~yue].mean()), 4) if (~yue).any() else None}
                if m != "a learned head":
                    record[m]["vs a"] = mcnemar(hits["a learned head"], h)
            report(out, record)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("sweep", "detail"):
        p = sub.add_parser(name)
        p.add_argument("base", help="the checkpoint fine-tuning started from (stage 2)")
        if name == "sweep":
            p.add_argument("checkpoints", nargs="+")
            p.add_argument("--alphas", type=float, nargs="+", default=[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0])
        else:
            p.add_argument("checkpoint")
            p.add_argument("--tunes", type=int, default=400, help="random YuE2-seen tunes, besides every tune with a real clip")
            p.add_argument("--per-tune", type=int, default=6, help="windows of each tune per source")
            p.add_argument("--yue-recordings", type=int, default=8000, help="YuE2 recordings counted for centre usage")
    p = sub.add_parser("compare")
    p.add_argument("models", nargs="+", help="checkpoints (PATH or PATH@k1); each is tested against the first")
    p = sub.add_parser("rerank")
    p.add_argument("checkpoint")
    p.add_argument("--top", type=int, default=20, help="shortlist the re-ranker chooses from")
    p = sub.add_parser("errors")
    p.add_argument("checkpoint")
    p = sub.add_parser("prototypes")
    p.add_argument("checkpoint")
    p.add_argument("--per-tune", type=int, default=32, help="simulated windows per tune")
    p.add_argument("--parts", type=int, default=8, help="stretches of each tune with their own centre (a multiple of 8 above 8)")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--save", type=Path, help="keep the centres here, for export_finder.py --sim-centres")
    for p in sub.choices.values():
        p.add_argument("--clips", type=Path, default=c.CLIPS)
        p.add_argument("--reference", type=Path, help="clip file whose YouTube clips choices were made on; the rest are held out")
        p.add_argument("--out", type=Path, default=c.ML / "scratch" / "diagnose.jsonl")
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    {"sweep": sweep, "detail": detail, "compare": compare, "rerank": rerank, "errors": errors, "prototypes": prototypes}[args.command](args)


if __name__ == "__main__":
    main()
