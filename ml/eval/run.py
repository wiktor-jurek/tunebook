"""Scores a Listen engine on the real-world YouTube benchmark.

Engines are commands that read a JSON list of {id, path} clips and write one JSON
line per clip: {"id", "rankings": {"5": [tune_id, ...], "10": [...], "15": [...]},
"confident": {"seconds", "tuneId"} | null}.

    uv run python eval/run.py symbolic            # the existing note-matching engine
    uv run python eval/run.py symbolic --all      # include unverified labels
"""

import argparse
import csv
import json
import statistics
import subprocess
from collections import defaultdict
from pathlib import Path

from fetch_youtube import clip_path

ROOT = Path(__file__).parent.parent
REPO = ROOT.parent
ENGINES = {
    "symbolic": ["node", "--max-old-space-size=4096", "node_modules/.bin/tsx", "scripts/listen-engine.ts"],
}


def score(rows: list[dict], output: dict[str, dict]) -> dict:
    metrics: dict = {"clips": len(rows)}
    for checkpoint in ("5", "10", "15"):
        ranks = []
        for row in rows:
            ranking = output[row["id"]]["rankings"].get(checkpoint, [])
            ranks.append(ranking.index(int(row["tune_id"])) + 1 if int(row["tune_id"]) in ranking else None)
        metrics[f"top1@{checkpoint}s"] = sum(rank == 1 for rank in ranks) / len(rows)
        metrics[f"top5@{checkpoint}s"] = sum(rank is not None and rank <= 5 for rank in ranks) / len(rows)
        metrics[f"mrr@{checkpoint}s"] = sum(1 / rank for rank in ranks if rank) / len(rows)
    confident = [(row, output[row["id"]]["confident"]) for row in rows if output[row["id"]]["confident"]]
    metrics["confident"] = len(confident) / len(rows)
    metrics["false_confident"] = sum(result["tuneId"] != int(row["tune_id"]) for row, result in confident) / len(rows)
    metrics["median_confident_s"] = statistics.median(result["seconds"] for _, result in confident) if confident else None
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("engine", choices=ENGINES)
    parser.add_argument("--all", action="store_true", help="include unreviewed labels (never wrong ones or sets)")
    args = parser.parse_args()

    with (ROOT / "eval" / "youtube.csv").open() as handle:
        rows = [row for row in csv.DictReader(handle) if row["verified"] == "yes" or (args.all and not row["verified"])]
    for row in rows:
        row["id"], row["path"] = row["youtube_id"], str(clip_path(row))
    rows = [row for row in rows if Path(row["path"]).exists()]
    if not rows:
        raise SystemExit("No clips: verify labels in eval/youtube.csv (or pass --all) and run eval/fetch_youtube.py")

    runs = ROOT / "runs"
    runs.mkdir(exist_ok=True)
    clips, out = runs / f"{args.engine}.clips.json", runs / f"{args.engine}.jsonl"
    clips.write_text(json.dumps([{"id": row["id"], "path": row["path"]} for row in rows]))
    subprocess.run([*ENGINES[args.engine], str(clips), str(out)], cwd=REPO, check=True)
    output = {line["id"]: line for line in map(json.loads, out.read_text().splitlines()) if line}

    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups["all"].append(row)
        groups[f"kind={row['kind']}"].append(row)
        groups[f"instrument={row['instrument']}"].append(row)
        if row["backing"]:
            groups[f"backing={row['backing']}"].append(row)
    print(f"engine={args.engine} labels={'all' if args.all else 'verified'}")
    for name, members in sorted(groups.items(), key=lambda item: (item[0] != "all", item[0])):
        metrics = score(members, output)
        print(f"{name:28} n={metrics['clips']:4d}  top1@10s={metrics['top1@10s']:.1%}  top5@10s={metrics['top5@10s']:.1%}  top1@15s={metrics['top1@15s']:.1%}  "
              f"confident={metrics['confident']:.1%}  false_confident={metrics['false_confident']:.1%}  median_s={metrics['median_confident_s']}")


if __name__ == "__main__":
    main()
