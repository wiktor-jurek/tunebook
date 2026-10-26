"""Maps Reels50 irishtune.info tune IDs to The Session tune IDs by title.

irishtune.info lists every title a tune is known by; the first one that names a reel
in our catalog wins, preferring the most popular match. Rows with several candidates
or none need a human check (`verified`).

    uv run python eval/reels50_map.py
"""

import csv
import gzip
import io
import json
import re
import time
import unicodedata
from html import unescape
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
POPULARITY_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tune_popularity.csv"
FIELDS = ["irishtune_id", "irishtune_name", "tune_id", "title", "match", "candidates", "verified"]


def normalise(title: str) -> str:
    title = unicodedata.normalize("NFKD", unescape(title)).encode("ascii", "ignore").decode().lower()
    title = re.sub(r"^(.*), (the|a|an)$", r"\2 \1", title.strip())
    title = re.sub(r"^(the|a|an) ", "", title)
    title = re.sub(r"\b(reel|the)\b", " ", title.replace("'", ""))
    return re.sub(r"[^a-z0-9]+", " ", title).strip()


def irishtune_titles(tune: str) -> tuple[str, list[str]]:
    html = requests.get(f"https://www.irishtune.info/tune/{tune}/", timeout=60, headers={"User-Agent": "tunebook-eval/0.1"}).text
    name = re.search(r'"@type":"MusicComposition".*?"name":"([^"]+)"', html).group(1)
    text = re.sub(r"<[^>]+>", " ", html)
    listed = re.search(r"given to this tune in the sources listed below[^:]*:\s*(.+?)\n", text)
    titles = [part.strip() for part in listed.group(1).split(" / ")] if listed else []
    return unescape(name), [unescape(name), *titles]


def main() -> None:
    works = sorted({json.loads(line)["work"] for path in (ROOT / "data" / "reels50").glob("*.full.txt") for line in path.open() if line.strip()}, key=int)
    reels: dict[str, set[int]] = {}
    titles: dict[int, str] = {}
    with gzip.open(ROOT / "data" / "catalog.jsonl.gz", "rt") as handle:
        for line in handle:
            row = json.loads(line)
            if (row["kind"] or "").lower() == "reel":
                reels.setdefault(normalise(row["title"]), set()).add(row["tuneId"])
                titles[row["tuneId"]] = row["title"]
    popularity = {int(row["tune_id"]): int(row["tunebooks"]) for row in csv.DictReader(io.StringIO(requests.get(POPULARITY_URL, timeout=60).text)) if row["tune_id"].isdigit()}

    rows = []
    for work in works:
        name, known = irishtune_titles(work)
        candidates: list[int] = []
        match = "none"
        for position, title in enumerate(known):
            found = sorted(reels.get(normalise(title), ()), key=lambda tune_id: -popularity.get(tune_id, 0))
            if found:
                candidates = found
                match = "primary" if position == 0 else "alternate"
                break
        best = candidates[0] if candidates else ""
        rows.append({
            "irishtune_id": work, "irishtune_name": name, "tune_id": best, "title": titles.get(best, ""), "match": match,
            "candidates": " ".join(map(str, candidates[1:6])), "verified": "",
        })
        print(f"{work:>5} {name:40} -> {best} {titles.get(best, '')} ({match}{', ambiguous' if len(candidates) > 1 else ''})")
        time.sleep(1)
    with (ROOT / "eval" / "reels50_map.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, FIELDS)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
