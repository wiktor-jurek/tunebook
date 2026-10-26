"""Proposes YouTube clips of popular tunes for the real-world benchmark.

Labels come from video titles, so every row starts unverified: listen and set
`verified` to `yes` (or fix `tune_id`) before a row counts in results.

    uv run python eval/youtube_candidates.py --tunes 300 --out eval/youtube.csv
"""

import argparse
import csv
import gzip
import io
import json
import re
import subprocess
import unicodedata
from pathlib import Path

import requests

POPULARITY_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tune_popularity.csv"
CATALOG = Path(__file__).parent.parent / "data" / "catalog.jsonl.gz"
# Lessons and slow airs have talking or tempos nobody plays at a session; sets and
# medleys make the label ambiguous unless the named tune comes first.
EXCLUDE = re.compile(r"\b(lesson|tutorial|how to|learn|slow|backing track|play along|karaoke|lyrics|sheet music|midi)\b", re.I)
SET_MARKERS = re.compile(r"[/|]|\bset\b|\bmedley\b|\s&\s|\band\s+the\b", re.I)
INSTRUMENTS = ["fiddle", "tin whistle", "flute", "accordion", "concertina", "banjo", "uilleann pipes", "session"]
FIELDS = ["youtube_id", "start_s", "duration_s", "tune_id", "title", "kind", "video_title", "query", "instrument", "backing", "verified", "notes"]


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text.replace("'", "")).strip()


def display_title(title: str) -> str:
    """The Session files titles as "Kesh, The"; people say "The Kesh"."""
    match = re.match(r"^(.*), (The|A|An)$", title)
    return f"{match.group(2)} {match.group(1)}" if match else title


def search(query: str, count: int) -> list[dict]:
    result = subprocess.run(["yt-dlp", "--flat-playlist", "-J", f"ytsearch{count}:{query}"], capture_output=True, text=True, timeout=120)
    if result.returncode:
        return []
    return json.loads(result.stdout).get("entries") or []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tunes", type=int, default=300, help="most popular tunes to try")
    parser.add_argument("--out", default="eval/youtube.csv")
    args = parser.parse_args()

    tunes: dict[int, dict] = {}
    with gzip.open(CATALOG, "rt") as handle:
        for line in handle:
            row = json.loads(line)
            tunes.setdefault(row["tuneId"], {"title": row["title"], "kind": row["kind"]})
    popularity = csv.DictReader(io.StringIO(requests.get(POPULARITY_URL, timeout=60).text))
    ranked = sorted(((int(row["tunebooks"]), int(row["tune_id"])) for row in popularity if row["tune_id"].isdigit() and int(row["tune_id"]) in tunes), reverse=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    existing = {}
    if out.exists():
        with out.open() as handle:
            existing = {int(row["tune_id"]): row for row in csv.DictReader(handle)}
    rows = list(existing.values())
    for index, (_, tune_id) in enumerate(ranked[: args.tunes]):
        if tune_id in existing:
            continue
        tune = tunes[tune_id]
        name = display_title(tune["title"])
        key = normalise(re.sub(r"^(The|A|An) ", "", name))
        instrument = INSTRUMENTS[index % len(INSTRUMENTS)]
        query = f"{name} {tune['kind'] or ''} {instrument} irish"
        for entry in search(query, 8):
            video_title, duration = entry.get("title") or "", entry.get("duration") or 0
            if not 45 <= duration <= 600 or EXCLUDE.search(video_title):
                continue
            words = normalise(video_title)
            position = words.find(key)
            if position < 0:
                continue
            # In a set, only trust the label when the tune is named first.
            if SET_MARKERS.search(video_title) and position > len(normalise(re.split(r"[/|]", video_title)[0])):
                continue
            rows.append({
                "youtube_id": entry["id"], "start_s": 20 if duration > 90 else 5, "duration_s": 15, "tune_id": tune_id,
                "title": tune["title"], "kind": tune["kind"], "video_title": video_title, "query": query,
                "instrument": instrument, "backing": "", "verified": "", "notes": "",
            })
            print(f"{len(rows):4d} {tune['title']} <- {video_title}")
            break
        with out.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, FIELDS)
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    main()
