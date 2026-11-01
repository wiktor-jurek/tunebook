"""Finds The Session tunes by the names people write: titles of every setting plus The Session's aliases.

Aliases come from TheSession-data's aliases.csv, cached in cache/thesession/. Ties go to the tune in
more members' tunebooks, so "The Kesh" is the jig everyone plays rather than a namesake.
"""

import csv
import gzip
import json
import re
from collections import defaultdict
from pathlib import Path

import requests

from youtube_candidates import display_title, normalise

ML = Path(__file__).parent.parent
ALIASES_URL = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/aliases.csv"
ALIASES = ML / "cache" / "thesession" / "aliases.csv"
KINDS = {"reel", "jig", "slip jig", "hop jig", "polka", "slide", "hornpipe", "barndance", "mazurka", "waltz", "strathspey", "march", "three-two"}


def key(name: str) -> str:
    """A name with articles, "No." and punctuation dropped: "The Crowley's #1" and "Crowley's No. 1" agree."""
    text = normalise(display_title(name.replace("’", "'")))
    text = re.sub(r"\b(no|number)\s+(?=\d)", "", text)
    return re.sub(r"^(the|an|a) ", "", text)


def variants(name: str) -> list[str]:
    """A written name and its bracketed alternative: "Macleod's Farewell (The Wedding)" is either."""
    names = [name]
    bracket = re.match(r"^(.*?)\s*\((?:aka\s+)?(.+)\)\s*$", name, re.I)
    if bracket:
        names += [bracket.group(1), bracket.group(2)]
    # "Cooley's Reel", "Hornpipe The Home Ruler", "Tobin's Favorite": the type and spelling are extras.
    kinds = r"(?:reel|jig|slip jig|polka|slide|hornpipe|waltz|mazurka|barndance)"
    names += [re.sub(rf"^{kinds}\s+|\s+{kinds}$", "", n, flags=re.I) for n in names]
    names += [n.replace("Favorite", "Favourite").replace("favorite", "favourite") for n in names]
    return list(dict.fromkeys(n for n in names if n.strip()))


class Tunes:
    def __init__(self) -> None:
        self.info: dict[int, dict] = {}
        self.names: dict[str, set[int]] = defaultdict(set)
        with gzip.open(ML / "data" / "catalog.jsonl.gz", "rt") as handle:
            for line in handle:
                setting = json.loads(line)
                tune = setting["tuneId"]
                self.info.setdefault(tune, {"title": display_title(setting["title"]), "kind": setting["kind"]})
                self.names[key(setting["title"])].add(tune)
        if not ALIASES.exists():
            ALIASES.parent.mkdir(parents=True, exist_ok=True)
            ALIASES.write_bytes(requests.get(ALIASES_URL, timeout=60).content)
        with ALIASES.open() as handle:
            for row in csv.DictReader(handle):
                if int(row["tune_id"]) in self.info:
                    self.names[key(row["alias"])].add(int(row["tune_id"]))
        self.popularity: dict[int, int] = {}
        with (ML / "data" / "tune_popularity.csv").open() as handle:
            for row in csv.DictReader(handle):
                self.popularity[int(row["tune_id"])] = int(row["tunebooks"])

    def ranked(self, tunes: set[int]) -> list[int]:
        return sorted(tunes, key=lambda tune: -self.popularity.get(tune, 0))

    def match(self, name: str, kind: str | None = None) -> tuple[list[int], str]:
        """Candidate tune IDs, best first, and how sure: exact (one tune), popular (the most played
        of several), kind (only a tune of another type has the name) or none."""
        found = set().union(*(self.names.get(key(n), set()) for n in variants(name)))
        if not found:
            return [], "none"
        fitting = {tune for tune in found if not kind or self.info[tune]["kind"] == kind}
        if not fitting:
            return self.ranked(found), "kind"
        return self.ranked(fitting) + self.ranked(found - fitting), "exact" if len(fitting) == 1 else "popular"

    def search(self, query: str, limit: int = 8) -> list[dict]:
        """Tunes whose name starts with or contains the query, most played first, for the labeller."""
        wanted = key(query)
        if not wanted:
            return []
        if wanted.isdigit() and int(wanted) in self.info:
            return [{"tune_id": int(wanted), **self.info[int(wanted)]}]
        hits: dict[int, int] = {}
        for name, tunes in self.names.items():
            score = 0 if name == wanted else 1 if name.startswith(wanted) else 2 if wanted in name else None
            if score is not None:
                for tune in tunes:
                    hits[tune] = min(score, hits.get(tune, 3))
        best = sorted(hits, key=lambda tune: (hits[tune], -self.popularity.get(tune, 0)))[:limit]
        return [{"tune_id": tune, **self.info[tune]} for tune in best]
