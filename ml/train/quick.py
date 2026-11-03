"""The quick harness: compare front-end and simulator ideas in about half an hour a run, not a 60k-step stage 2.

Every run trains from scratch on the same ~2,500 tunes (every eval-clip tune, every tune with found audio, a
seeded random fill), then scores the real clips the way the finder ranks: simulated part centres (8 parts,
32 windows a tune) plus the popularity prior, against those tunes only. Absolute numbers run higher than the
full catalogue's; only paired differences between runs on the same tune set mean anything.

    python train/quick.py tunes                                   # once: cache/classifier/quick-tunes.json
    python train/quick.py run base                                # runs/classifier/quick-base/
    TUNEBOOK_RESTS=0 python train/quick.py run no-rests -- --render-fraction 0
    python train/quick.py compare base no-rests                  # paired, McNemar

Arguments after `--` go to classifier.py train. The environment (TUNEBOOK_FEATURES, TUNEBOOK_RESTS) is
recorded with the run. Renders keep the timing they were built with: give both arms `--render-fraction 0`
when testing the simulator.
"""

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import classifier as c  # noqa: E402
import export_finder as e  # noqa: E402
from tunebook_ml import pitchclass  # noqa: E402

TUNES = c.ML / "cache" / "classifier" / "quick-tunes.json"
RUNS = c.ML / "runs" / "classifier"
SETS = ("youtube", "albums", "bands")
PRIOR = 0.006  # decode.ts: per ln(tunebooks + 1)


def tunes(args) -> None:
    """The fixed tune set. Built from the 12-channel files: clips-v4-h.pt holds the same clips, so one set serves both."""
    clips = torch.load(c.ML / "cache" / "classifier" / "clips-v4.pt", weights_only=False)
    evaluated = {r["tune_id"] for rows in clips.values() for r in rows}
    found = {r["tune_id"] for r in torch.load(c.ML / "cache" / "classifier" / "found_train.pt", mmap=True, weights_only=False)}
    catalog = c.catalog_tunes()
    keep = (evaluated | found) & set(catalog)
    rest = [t for t in catalog if t not in keep]
    fill = np.random.default_rng(args.seed).choice(rest, max(0, args.size - len(keep)), replace=False).tolist()
    chosen = sorted(keep | set(fill))
    TUNES.write_text(json.dumps(chosen))
    print(f"{len(chosen)} tunes: {len(evaluated & keep)} with eval clips, {len(found & keep)} with found audio, {len(fill)} random → {TUNES}")


@torch.no_grad()
def score(checkpoint: Path, centres: Path, clips_path: Path) -> dict:
    """Per-clip hits: simulated part centres + prior (what the finder does), and the learned head + prior."""
    out = {"sets": {}}
    for method in ("sim", "head"):
        model, ckpt = (e.load(str(checkpoint), one_centre=True, sim_centres=str(centres), sim_parts=8) if method == "sim"
                       else e.load(str(checkpoint), one_centre=True))
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device)
        if model.shrink is not None:
            model.shrink = model.shrink.to(device)
        tune_ids = ckpt["tune_ids"]
        index = {t: i for i, t in enumerate(tune_ids)}
        counts = c.popularity()
        prior = PRIOR * torch.log(torch.tensor([counts.get(t, 0) for t in tune_ids], dtype=torch.float32) + 1).to(device)
        clips = torch.load(clips_path, weights_only=False)
        for name in SETS:
            rows = [r for r in clips.get(name, []) if r["tune_id"] in index]
            hits = []
            for row in rows:
                x = row["windows"].float() / (255 if row["windows"].dtype == torch.uint8 else 1)
                x = pitchclass.keycanon(x.to(device))
                mean = torch.cat([model.cosines(e.embed(model, x[i:i + 64])) for i in range(0, len(x), 64)]).mean(0)
                hits.append(int((mean + prior).argmax()) == index[row["tune_id"]])
            entry = out["sets"].setdefault(name, {"tune_ids": [r["tune_id"] for r in rows], "hits": {}})
            entry["hits"][method] = hits
    return out


def summary(result: dict, method: str = "sim") -> str:
    return ", ".join(f"{name} {100 * np.mean(s['hits'][method]):.1f}%" for name, s in result["sets"].items())


def run(args, extra: list[str]) -> None:
    out = RUNS / f"quick-{args.name}"
    out.mkdir(parents=True, exist_ok=True)
    env = {k: os.environ[k] for k in ("TUNEBOOK_FEATURES", "TUNEBOOK_RESTS") if k in os.environ}
    clips = args.clips or c.cache_path("clips-v4.pt")
    (out / "quick.json").write_text(json.dumps({"env": env, "init": str(args.init or ""), "steps": args.steps, "extra": extra, "clips": str(clips), "started": time.ctime()}))
    py = [sys.executable]
    started = time.time()
    if not args.skip_train:
        subprocess.run(py + [str(c.ML / "train" / "classifier.py"), "train", "--name", f"quick-{args.name}", "--tune-set", str(TUNES),
                        "--clips", str(clips), "--steps", str(args.steps), "--eval-every", str(args.steps), "--batch", "256",
                        "--workers", str(args.workers), "--layers", "6", "--lr", "3e-4", "--sample-classes", "0", "--yue-fraction", "0.2",
                        "--seed", str(args.seed), *(["--init", str(args.init), "--no-freeze-head", "--margin-start", "0"] if args.init else []),
                        *extra], check=True)
    trained = time.time()
    centres = out / "centres.pt"
    subprocess.run(py + [str(c.ML / "train" / "diagnose.py"), "prototypes", str(out / "last.pt"), "--per-tune", "32", "--parts", "8",
                    "--workers", str(args.workers), "--save", str(centres), "--clips", str(clips), "--out", str(out / "diagnose.jsonl")], check=True)
    result = score(out / "last.pt", centres, clips)
    result.update(env=env, extra=extra, minutes={"train": round((trained - started) / 60, 1), "total": round((time.time() - started) / 60, 1)})
    (out / "hits.json").write_text(json.dumps(result))
    print(f"quick-{args.name} {env or ''}: sim centres {summary(result)} | learned head {summary(result, 'head')} | {result['minutes']}")


def mcnemar(b: int, a: int) -> float:
    n = b + a
    return 1.0 if n == 0 else min(1.0, 2 * sum(math.comb(n, k) for k in range(min(a, b) + 1)) / 2 ** n)


def compare(args) -> None:
    missing = [name for name in args.names if not (RUNS / f"quick-{name}" / "hits.json").exists()]
    if missing:
        print(f"no results (skipped): {', '.join(missing)}")
    args.names = [name for name in args.names if name not in missing]
    runs = [json.loads((RUNS / f"quick-{name}" / "hits.json").read_text()) for name in args.names]
    base = runs[0]
    for name, other in zip(args.names[1:], runs[1:]):
        for method in ("sim", "head"):
            parts, gained, lost = [], 0, 0
            for s in SETS:
                a, b = base["sets"][s], other["sets"][s]
                assert a["tune_ids"] == b["tune_ids"], f"{s}: different clips"
                ha, hb = a["hits"][method], b["hits"][method]
                g, l = sum(y and not x for x, y in zip(ha, hb)), sum(x and not y for x, y in zip(ha, hb))
                gained, lost = gained + g, lost + l
                parts.append(f"{s} {100 * np.mean(ha):.1f}→{100 * np.mean(hb):.1f} (+{g}/−{l})")
            print(f"{args.names[0]} → {name} [{method}]: " + ", ".join(parts) + f" | all +{gained}/−{lost}, p {mcnemar(gained, lost):.3f}")


def main() -> None:
    argv = sys.argv[1:]
    extra = argv[argv.index("--") + 1:] if "--" in argv else []
    argv = argv[: argv.index("--")] if "--" in argv else argv
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    t = sub.add_parser("tunes")
    t.add_argument("--size", type=int, default=2500)
    t.add_argument("--seed", type=int, default=0)
    r = sub.add_parser("run")
    r.add_argument("name")
    r.add_argument("--steps", type=int, default=6000)
    r.add_argument("--workers", type=int, default=6)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--clips", type=Path, help="default: clips-v4 for these features")
    r.add_argument("--skip-train", action="store_true", help="reuse the run's last.pt and only score it")
    r.add_argument("--init", type=Path, help="warm start: continue from this backbone (head rows mapped by tune id, head trained). "
                   "From scratch, 12-channel models sit on a plateau for ~8k steps, so 12-channel ideas need this")
    k = sub.add_parser("compare")
    k.add_argument("names", nargs="+", help="run names; each is compared with the first")
    args = parser.parse_args(argv)
    if args.command == "run":
        run(args, extra)
    elif args.command == "tunes":
        tunes(args)
    else:
        compare(args)


if __name__ == "__main__":
    main()
