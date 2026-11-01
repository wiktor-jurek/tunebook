"""The session benchmark: whole pub sessions whose uploader lists every set with its start time.

Portland Irish Music (youtube.com/@ChaunceyCanfieldCeltic) records the weekly session at the 13th Moon
Gravity Well and writes the setlist into each video's description:

    00:04:47 Reel Set: Macleod's Farewell (The Wedding) / The Torn Jacket / The Virginia

This reads those lines for VIDEOS, finds each named tune on The Session (eval/tune_names.py) and writes
them to the data home (tunebook_ml/store.py): one youtube_full source per video and a segment per tune, in
playing order. A set runs from its timestamp to the next one;
each tune starts with an even share of its set until it is labelled in the app's labeller (/admin/label, Sessions),
where the boundaries between tunes are dragged into place and the tune IDs confirmed.

Benchmarks use segments marked correct: each is a single-tune clip (classifier.py prepare, "sessions",
via store_export.py), and the sets in order are the setlists an "upload a session" feature should reproduce.

    uv run --group store python eval/sessions.py            # refresh unlabelled sets; labelled ones are kept
    uv run --group store python eval/sessions.py --audio    # also fetch each recording and put it in the bucket
    uv run --group store python eval/analyse_sources.py     # then cut the labeller's set windows
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from fetch_youtube import fetch_full, full_path
from psycopg.types.json import Jsonb
from tune_names import KINDS, Tunes

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tunebook_ml import store  # noqa: E402

ML = Path(__file__).parent.parent
# Ten sessions spread from July 2025 to September 2026, each over 30 minutes. Earlier descriptions name
# only the set type ("Reel set:"), so they can't label tunes.
VIDEOS = ["7QPekdFlWo4", "jFXGWAbsouE", "ZIW-NQ8nZUM", "nrdnK2MrjiA", "hOGLmYnSiqY",
          "SodOetpeOy0", "Q29HL9rO6tU", "4VLoonl9WbU", "CrN_ZCpVnfk", "Wqe7BKCepn0"]
LINE = re.compile(r"^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]?\s*(.+?)\s*$")
SONG = re.compile(r"\bsong\b", re.I)


def seconds(stamp: str) -> int:
    total = 0
    for part in stamp.split(":"):
        total = total * 60 + int(part)
    return total


def set_kind(label: str) -> str | None:
    """ "Slip Jig set" → "slip jig"; "Mixed set" or a bare tune name → None."""
    word = re.sub(r"\s*(sets?|s)$", "", label.strip().lower())
    return word if word in KINDS else None


def setlist(description: str, duration: int) -> list[dict]:
    """Each timestamped line as a set: when it starts and ends, its type and the tunes named in it."""
    sets = []
    for line in description.splitlines():
        match = LINE.match(line)
        if not match:
            continue
        text = match.group(2)
        label, colon, rest = text.partition(":")
        kind = set_kind(label) if colon else set_kind(text)
        # "Reel Set: A / B", "Reel Set:" with no names, "Reel Set" alone, or just a tune's name.
        names = rest if colon and (kind or SONG.search(label) or "set" in label.lower()) else "" if kind else text
        sets.append({"start": seconds(match.group(1)), "kind": kind or "",
                     "song": bool(SONG.search(text)), "names": [n.strip() for n in names.split("/") if n.strip()]})
    for this, following in zip(sets, sets[1:] + [None]):
        this["end"] = following["start"] if following else duration
    return [s for s in sets if s["end"] > s["start"]]


def video(youtube_id: str) -> dict:
    result = subprocess.run(["yt-dlp", "-q", "--skip-download", "--print", "%(.{title,duration,description})j",
                             f"https://www.youtube.com/watch?v={youtube_id}"], capture_output=True, text=True, check=True, timeout=120)
    return json.loads(result.stdout)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", action="store_true", help="fetch each whole recording and put it in the bucket")
    args = parser.parse_args()
    tunes = Tunes()
    db = store.db()
    total, counts = 0, {"exact": 0, "popular": 0, "kind": 0, "none": 0}
    for youtube_id in VIDEOS:
        info = video(youtube_id)
        sets = setlist(info["description"], int(info["duration"]))
        print(f"{youtube_id} {info['title']}: {len(sets)} sets")
        key = None
        if args.audio:
            print(f"  audio: {fetch_full(youtube_id)}")
        if full_path(youtube_id).exists():
            key = store.put_audio(full_path(youtube_id), f"ml/audio/youtube/full/{full_path(youtube_id).name}")
        source = store.upsert_source("youtube_full", youtube_id, key, title=info["title"], duration_s=float(info["duration"]))
        for number, item in enumerate(sets, 1):
            set_id = f"{youtube_id}#{number}"
            # A set with any labelled tune is kept as labelled; the rest are rebuilt from the description.
            if db.execute("select 1 from ml.segments where source_id = %s and set_id = %s and verified is not null and label_source = 'human'",
                          (source, set_id)).fetchone():
                continue
            db.execute("delete from ml.segments where source_id = %s and set_id = %s", (source, set_id))
            names = item["names"] or [""]  # an unnamed set still gets a row, to name in the labeller
            share = (item["end"] - item["start"]) / len(names)
            for position, name in enumerate(names, 1):
                found, how = tunes.match(name, item["kind"] or None) if name else ([], "none")
                counts[how] = counts.get(how, 0) + 1
                start = item["start"] + (position - 1) * share
                store.upsert_segment(
                    source, round(start, 1), found[0] if found else None, end_s=round(start + share, 1), set_id=set_id, position=position,
                    label_source="description", confidence=0.5,
                    # Songs are sung: no tune to recognise, so they are left out of the benchmark from the start.
                    verified="no" if item["song"] else None, setting_tag="pub", notes="song" if item["song"] else None,
                    origin="eval/sessions.py",
                    meta=Jsonb({"described": name, "match": how, "candidates": found[1:6], "set_start_s": item["start"],
                                "set_end_s": item["end"], "set_kind": item["kind"]}))
                total += 1
    print(f"{total} unlabelled tunes refreshed; matches {counts}. Labelled sets were kept.")


if __name__ == "__main__":
    main()
