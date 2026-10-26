"""Tune names: The Session titles and aliases, and reading sets out of free text."""

import csv
import gzip
import io
import json
import re
import unicodedata
from functools import cache

import requests

from found.db import ROOT

THESESSION_DATA = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv"
CATALOG = ROOT / "data" / "catalog.jsonl.gz"
CACHE = ROOT / "cache" / "thesession"

# Words that decorate a name in titles without being part of it.
NOISE = re.compile(r"\b(the|a|an|reels?|jigs?|slip jigs?|single jigs?|double jigs?|hornpipes?|polkas?|slides?|mazurkas?|barndances?|flings?|strathspeys?|set dances?|set|medley|traditional|trad|irish)\b")
SEPARATORS = re.compile(r"\s*(?:/|\||;|,|\+|&|:\s|\s-\s|\s–\s|\s—\s|\band\b|\bwith\b|\binto\b)\s*")


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.replace("'", "").replace("’", ""))).strip()


def key(name: str) -> str:
    """Matching key: "Kesh, The" and "The Kesh Jig" both give "kesh"."""
    name = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", name)
    name = re.sub(r"^(.*), (The|A|An)$", r"\2 \1", name.strip())
    return re.sub(r"\s+", " ", NOISE.sub(" ", normalise(name))).strip()


def display(title: str) -> str:
    match = re.match(r"^(.*), (The|A|An)$", title)
    return f"{match.group(2)} {match.group(1)}" if match else title


def download(name: str) -> str:
    """A TheSession-data CSV, cached under cache/thesession."""
    path = CACHE / f"{name}.csv"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        response = requests.get(f"{THESESSION_DATA}/{name}.csv", timeout=120)
        response.raise_for_status()
        path.write_text(response.text)
    return path.read_text()


@cache
def tunes() -> dict[int, dict]:
    """Tunes with at least one setting in the exported catalog: {tune_id: {title, kind}}."""
    out: dict[int, dict] = {}
    with gzip.open(CATALOG, "rt") as handle:
        for line in handle:
            row = json.loads(line)
            out.setdefault(row["tuneId"], {"title": row["title"], "kind": row["kind"]})
    return out


@cache
def popularity() -> dict[int, int]:
    return {int(row["tune_id"]): int(row["tunebooks"]) for row in csv.DictReader(io.StringIO(download("tune_popularity")))
            if row["tune_id"].isdigit()}


@cache
def index() -> dict[str, list[int]]:
    """Matching key → tune ids, most popular first."""
    known = tunes()
    names: dict[str, set[int]] = {}
    for tune_id, tune in known.items():
        names.setdefault(key(tune["title"]), set()).add(tune_id)
    for row in csv.DictReader(io.StringIO(download("aliases"))):
        if row["tune_id"].isdigit() and int(row["tune_id"]) in known:
            names.setdefault(key(row["alias"]), set()).add(int(row["tune_id"]))
    names.pop("", None)
    rank = popularity()
    return {name: sorted(ids, key=lambda t: -rank.get(t, 0)) for name, ids in names.items()}


def read_set(text: str) -> list[tuple[str, list[int]]]:
    """Splits a title like "The Kesh / Cooley's (Jig and Reel)" into named pieces and the
    tunes each could be. Pieces that name no known tune keep an empty list, so callers can
    tell a complete set listing from a title with extra words in it."""
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", text)
    pieces = [piece for piece in SEPARATORS.split(text) if piece and piece.strip()]
    names = index()
    return [(piece.strip(), names.get(key(piece), [])) for piece in pieces if key(piece)]


def mentions(text: str, name: str) -> bool:
    """Whether a tune name appears in text as whole words."""
    wanted = key(name)
    return bool(wanted) and f" {wanted} " in f" {key(text)} "
