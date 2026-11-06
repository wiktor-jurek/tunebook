"""Found songs: real recordings of catalog tunes for training and evaluation.

Everything is written to the data home and the private bucket as it is found (found/db.py): each recording is a
whole album track, its tunes labelled where they are known and named in the labeller (/admin/label) after that.

    uv run --group store python -m found albums --searches 200      # The Session album tracks → YouTube
    uv run --group store python -m found titles --searches 200      # popular tunes by name
    uv run --group store python -m found fetch                      # whole tracks into the bucket
    uv run --group store python -m found stats
    uv run --group store python -m found export                     # data/found/manifest.jsonl for training

Add --cookies-from-browser chrome when YouTube asks to confirm you are not a bot.
"""

import argparse

from tunebook_ml import store
from tunebook_ml.splits import split_of

ALBUMS = "s.kind = 'album' and coalesce(s.status, '') <> 'merged'"  # sections merged into their track count with it


def stats() -> None:
    db = store.db()
    print(f"{db.execute('select count(*) n from ml.searches').fetchone()['n']} searches")
    sources = db.execute(f"select count(*) n, count(storage_key) stored, count(*) filter (where external_id = meta->>'video') tracks "
                         f"from ml.sources s where {ALBUMS}").fetchone()
    print(f"{sources['n']} recordings ({sources['tracks']} whole tracks, the rest 30 s sections); {sources['stored']} with audio in the bucket")
    total = db.execute(f"select count(*) n, count(distinct g.tune_id) tunes, count(*) filter (where g.verified = 'yes') yes, "
                       f"count(*) filter (where g.verified = 'no') no, count(*) filter (where g.tune_id is null) gaps "
                       f"from ml.segments g join ml.sources s on s.id = g.source_id where {ALBUMS}").fetchone()
    print(f"{total['n'] - total['gaps']} labelled stretches of {total['tunes']} tunes, {total['gaps']} unnamed; "
          f"{total['yes']} verified, {total['no']} rejected")
    for row in db.execute(f"select g.label_source, count(*) n, round(avg(g.confidence)::numeric, 2) prior from ml.segments g "
                          f"join ml.sources s on s.id = g.source_id where {ALBUMS} and g.tune_id is not null group by 1 order by 2 desc"):
        print(f"  {row['label_source']:12} {row['n']:6d}  prior {row['prior']}")
    licences = db.execute(f"select coalesce(licence, 'unstated') licence, count(*) n from ml.sources s where {ALBUMS} group by 1 order by 2 desc")
    print("licences: " + ", ".join(f"{row['licence']} {row['n']}" for row in licences))
    roles = store.roles()
    splits: dict[str, int] = {}
    for row in db.execute(f"select g.tune_id from ml.segments g join ml.sources s on s.id = g.source_id where {ALBUMS} and g.tune_id is not null"):
        name = "benchmark" if roles.get(row["tune_id"]) == "eval" else split_of(row["tune_id"])
        splits[name] = splits.get(name, 0) + 1
    print("splits: " + ", ".join(f"{name} {count}" for name, count in sorted(splits.items())))


def export() -> None:
    """data/found/manifest.jsonl from the data home (store_export.py), for training and evaluation."""
    import store_export
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
