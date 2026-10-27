"""Did an ACE-Step cover keep its tune? Cover mode keeps the source's timing, so the clip's
pitch-class salience is compared frame by frame with its own dry source (best lag within
±1 s), against the same comparison with other tunes' sources as a baseline. A ratio well
over 1 means the melody survived.

    uv run python acestep/compare.py cache/acestep/pilot
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML), str(ML / "yue")]

from adherence import load  # noqa: E402
from tunebook_ml.pitchclass import FPS, from_audio  # noqa: E402


def salience(path: Path) -> np.ndarray:
    pcs = from_audio(torch.from_numpy(load(path))[None], canon=False)[0].numpy()
    return pcs / (np.linalg.norm(pcs, axis=0, keepdims=True) + 1e-9)


def fit(clip: np.ndarray, source: np.ndarray, max_lag: int = int(FPS)) -> float:
    """Mean frame cosine at the best lag, over the frames both cover."""
    best = 0.0
    for lag in range(-max_lag, max_lag + 1, 2):
        a, b = (clip[:, lag:], source) if lag >= 0 else (clip, source[:, -lag:])
        n = min(a.shape[1], b.shape[1])
        best = max(best, float((a[:, :n] * b[:, :n]).sum(axis=0).mean()))
    return best


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()
    requests = {r["name"]: r for r in map(json.loads, (args.folder / "requests.jsonl").open())}
    sources = {s: salience(args.folder / s) for s in sorted({r["source"] for r in requests.values()})}
    others = list(sources)
    rng = np.random.default_rng(0)
    rows = []
    for clip in sorted((args.folder / "out").glob("*.flac")):
        request = requests[clip.stem]
        pcs = salience(clip)
        own = fit(pcs, sources[request["source"]])
        foreign = [s for s in others if s.split("-")[1] != request["source"].split("-")[1]]
        baseline = np.mean([fit(pcs, sources[s]) for s in rng.choice(foreign, 4, replace=False)])
        rows.append({"name": clip.stem, "strength": request["strength"], "own": round(own, 3), "ratio": round(own / baseline, 2)})
        print(json.dumps(rows[-1]), flush=True)
    (args.folder / "compare.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    for strength in sorted({r["strength"] for r in rows}):
        ratios = [r["ratio"] for r in rows if r["strength"] == strength]
        print(f"strength {strength}: median ratio {np.median(ratios):.2f}, {sum(r > 1.3 for r in ratios)}/{len(ratios)} over 1.3")


if __name__ == "__main__":
    main()
