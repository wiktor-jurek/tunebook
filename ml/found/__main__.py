"""Found songs: real recordings of catalog tunes for training and evaluation.

    uv run python -m found albums --searches 200      # The Session album tracks → YouTube
    uv run python -m found titles --searches 200      # popular tunes by name
    uv run python -m found fetch                      # download labelled sections
    uv run python -m found stats
    uv run python -m found export                     # data/found/manifest.jsonl for training

Add --cookies-from-browser chrome when YouTube asks to confirm you are not a bot.
"""

import argparse
import csv
import json

from found.db import DATA, ROOT, connect
from tunebook_ml.splits import split_of


def benchmark_tunes() -> set[int]:
    with (ROOT / "eval" / "youtube.csv").open() as handle:
        return {int(row["tune_id"]) for row in csv.DictReader(handle) if row["tune_id"].isdigit()}


def stats() -> None:
    db = connect()
    print(db.execute("select count(*) || ' searches' from searches").fetchone()[0])
    print(db.execute("select count(*) || ' videos (' || sum(status = 'ok') || ' available)' from videos").fetchone()[0])
    total = db.execute("select count(*), count(distinct tune_id), count(distinct video_id), count(audio), sum(verified = 'yes'), sum(verified = 'no') from found").fetchone()
    print(f"{total[0]} found sections of {total[1]} tunes in {total[2]} videos; {total[3]} downloaded; {total[4] or 0} verified, {total[5] or 0} rejected")
    for row in db.execute("select label_source, count(*), round(avg(confidence), 2) from found group by 1 order by 2 desc"):
        print(f"  {row[0]:12} {row[1]:6d}  prior {row[2]}")
    licences = db.execute("select coalesce(licence, 'unstated'), count(*) from videos v join found f on f.video_id = v.id group by 1 order by 2 desc").fetchall()
    print("licences: " + ", ".join(f"{name} {count}" for name, count in licences))
    bench = benchmark_tunes()
    splits: dict[str, int] = {}
    for (tune_id,) in db.execute("select tune_id from found"):
        name = "benchmark" if tune_id in bench else split_of(tune_id)
        splits[name] = splits.get(name, 0) + 1
    print("splits: " + ", ".join(f"{name} {count}" for name, count in sorted(splits.items())))


def export(min_confidence: float) -> None:
    """Training manifest. Benchmark tunes are marked so training can keep them out, which
    keeps real-clip scores honest about tunes the model has never heard really played."""
    db, bench = connect(), benchmark_tunes()
    rows = db.execute("""
        select f.*, v.channel, v.licence from found f join videos v on v.id = f.video_id
        where f.audio is not null and coalesce(f.verified, '') != 'no' and (f.verified = 'yes' or f.confidence >= ?)
        order by f.tune_id, f.id""", (min_confidence,)).fetchall()
    path = DATA / "manifest.jsonl"
    with path.open("w") as handle:
        for row in rows:
            handle.write(json.dumps({
                "tune_id": row["tune_id"], "audio": row["audio"], "video_id": row["video_id"], "channel": row["channel"],
                "start_s": row["start_s"], "end_s": row["end_s"], "confidence": 1.0 if row["verified"] == "yes" else row["confidence"],
                "label_source": row["label_source"], "licence": row["licence"],
                "split": "benchmark" if row["tune_id"] in bench else split_of(row["tune_id"]),
            }) + "\n")
    print(f"{len(rows)} sections → {path}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="found")
    parser.add_argument("--cookies-from-browser", dest="cookies", help="browser whose YouTube sign-in yt-dlp should use")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("albums", "titles"):
        command = commands.add_parser(name)
        command.add_argument("--searches", type=int, default=100, help="new searches to run")
        command.add_argument("--per-tune", type=int, default=4, help="stop looking for a tune once it has this many recordings")
        command.add_argument("--pause", type=float, default=1.0, help="seconds between YouTube requests")
        command.add_argument("--include-benchmark", action="store_true", help="also collect the benchmark's tunes (not for training)")
    command = commands.add_parser("fetch")
    command.add_argument("--limit", type=int, default=1000)
    command.add_argument("--workers", type=int, default=4)
    commands.add_parser("stats")
    command = commands.add_parser("export")
    command.add_argument("--min-confidence", type=float, default=0.8)
    args = parser.parse_args()

    if args.command in ("albums", "titles"):
        from found.harvest import Harvester, harvest_albums, harvest_titles
        harvester = Harvester(args.cookies, args.pause, args.include_benchmark)
        (harvest_albums if args.command == "albums" else harvest_titles)(harvester, args.searches, args.per_tune)
        stats()
    elif args.command == "fetch":
        from found.fetch import fetch
        fetch(args.limit, args.workers, args.cookies)
    elif args.command == "stats":
        stats()
    else:
        export(args.min_confidence)


if __name__ == "__main__":
    main()
