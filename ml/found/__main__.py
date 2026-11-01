"""Found songs: real recordings of catalog tunes for training and evaluation.

    uv run python -m found albums --searches 200      # The Session album tracks → YouTube
    uv run python -m found titles --searches 200      # popular tunes by name
    uv run python -m found fetch                      # download labelled sections
    uv run python -m found stats
    uv run --group store python -m found export       # into the data home, then data/found/manifest.jsonl

Add --cookies-from-browser chrome when YouTube asks to confirm you are not a bot.
"""

import argparse

from found.db import connect
from tunebook_ml.splits import benchmark_tunes as split_benchmark, split_of


def benchmark_tunes() -> set[int]:
    """Eval tunes only: the benchmark's train half (eval/benchmark_split.json) is training data like any other tune."""
    return split_benchmark()[0]


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


def export() -> None:
    """Brings the collected sections into the data home (tunebook_ml/store.py), uploading new audio to the
    bucket, then writes data/found/manifest.jsonl from it (store_export.py) for training and evaluation."""
    import store_export
    import store_import
    sections, searches = store_import.found()
    print(f"{sections} sections and {searches} searches in the data home")
    print(f"{store_export.albums()} sections → data/found/manifest.jsonl")


def main() -> None:
    parser = argparse.ArgumentParser(prog="found")
    parser.add_argument("--cookies-from-browser", dest="cookies", help="browser whose YouTube sign-in yt-dlp should use")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("albums", "titles"):
        command = commands.add_parser(name)
        command.add_argument("--searches", type=int, default=100, help="new searches to run")
        command.add_argument("--per-tune", type=int, default=4, help="stop looking for a tune once it has this many recordings")
        command.add_argument("--pause", type=float, default=1.0, help="seconds between YouTube requests")
        command.add_argument("--include-benchmark", action="store_true", help="also collect the benchmark's eval tunes (not for training)")
    command = commands.add_parser("fetch")
    command.add_argument("--limit", type=int, default=1000)
    command.add_argument("--workers", type=int, default=4)
    commands.add_parser("stats")
    commands.add_parser("export")
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
        export()


if __name__ == "__main__":
    main()
