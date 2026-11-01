"""Tune-level train/valid/test split, shared by synthetic training and the found-songs data."""

import zlib


def split_of(tune_id: int) -> str:
    bucket = zlib.crc32(str(tune_id).encode()) % 100
    return "train" if bucket < 90 else "valid" if bucket < 95 else "test"



def benchmark_tunes() -> tuple[set[int], set[int]]:
    """The benchmark's tunes (eval/youtube.csv and eval/sessions.csv) as (eval, train): eval tunes'
    real recordings never enter training; train tunes' recordings, labelled clips included, may.
    eval/benchmark_split.json fixes the split; a tune listed since follows its crc32 rule."""
    import csv
    import json
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    listed: set[int] = set()
    for name in ("youtube.csv", "sessions.csv"):
        path = root / "eval" / name
        if path.exists():
            with path.open() as handle:
                listed |= {int(row["tune_id"]) for row in csv.DictReader(handle) if row["tune_id"].isdigit()}
    fixed = json.loads((root / "eval" / "benchmark_split.json").read_text())
    train, known = set(fixed["train"]), set(fixed["train"]) | set(fixed["eval"])
    train |= {tune for tune in listed - known if zlib.crc32(f"bench{tune}".encode()) % 100 < 30}
    return listed - train, listed & train
