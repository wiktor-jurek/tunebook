"""Proposes YouTube clips of popular tunes for the real-world benchmark, in the data home (tunebook_ml/store.py).

Labels come from video titles, so every clip starts unchecked: check it, trim it and fix its tune in the
labeller (/admin/label, YouTube clips) before it counts. Each proposed video's first minutes are fetched
and put in the bucket, so it can be labelled at once.

    uv run --group store python eval/youtube_candidates.py --tunes 300
"""

import argparse
import csv
import gzip
import io
import json
import re
import subprocess
import unicodedata
import sys
from pathlib import Path

import requests
from fetch_youtube import fetch_source, source_path
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tunebook_ml import store  # noqa: E402

POPULARITY_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tune_popularity.csv"
CATALOG = Path(__file__).parent.parent / "data" / "catalog.jsonl.gz"
# Lessons and slow airs have talking or tempos nobody plays at a session; sets and
# medleys make the label ambiguous unless the named tune comes first.
EXCLUDE = re.compile(r"\b(lesson|tutorial|how to|learn|slow|backing track|play along|karaoke|lyrics|sheet music|midi)\b", re.I)
SET_MARKERS = re.compile(r"[/|]|\bset\b|\bmedley\b|\s&\s|\band\s+the\b", re.I)
INSTRUMENTS = ["fiddle", "tin whistle", "flute", "accordion", "concertina", "banjo", "uilleann pipes", "session"]


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
    args = parser.parse_args()

    tunes: dict[int, dict] = {}
    with gzip.open(CATALOG, "rt") as handle:
        for line in handle:
            row = json.loads(line)
            tunes.setdefault(row["tuneId"], {"title": row["title"], "kind": row["kind"]})
    popularity = csv.DictReader(io.StringIO(requests.get(POPULARITY_URL, timeout=60).text))
    ranked = sorted(((int(row["tunebooks"]), int(row["tune_id"])) for row in popularity if row["tune_id"].isdigit() and int(row["tune_id"]) in tunes), reverse=True)

    existing = {row["tune_id"] for row in store.db().execute(
        "select distinct g.tune_id from ml.segments g join ml.sources s on s.id = g.source_id where s.kind = 'youtube_video'")}
    added = 0
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
            row = {"youtube_id": entry["id"], "start_s": 20 if duration > 90 else 5}
            key = None
            if fetch_source(row).startswith(("ok", "cached")) and source_path(row).exists():
                key = store.put_audio(source_path(row), f"ml/audio/youtube/source/{source_path(row).name}")
            source = store.upsert_source("youtube_video", entry["id"], key, title=video_title, duration_s=float(duration),
                                         status="ok" if key else "missing",
                                         meta=Jsonb({"video": entry["id"], "offset_s": 0.0, "query": query, "instrument": instrument, "backing": ""}))
            store.upsert_segment(source, float(row["start_s"]), tune_id, end_s=float(row["start_s"]) + 15, label_source="title",
                                 confidence=0.7, origin="eval/youtube_candidates.py")
            added += 1
            print(f"{added:4d} {tune['title']} <- {video_title}{'' if key else ' (no audio yet)'}")
            break


if __name__ == "__main__":
    main()
