"""Writes the label files the training and evaluation tools read, from the data home (tunebook_ml/store.py):
eval/youtube.csv, eval/sessions.csv and data/found/manifest.jsonl. These files are outputs now: labels are
edited in the app (/admin/label), never here. Clips whose times were changed there are cut again from
their source audio (fetched from the bucket when it isn't on this machine).

    uv run --group store python store_export.py
"""

import argparse
import csv
import gzip
import json
from pathlib import Path

import soundfile

from tunebook_ml import store
from tunebook_ml.splits import split_of

ML = Path(__file__).resolve().parent
YOUTUBE = ML / "cache" / "youtube"
FOUND = ML / "data" / "found"
YOUTUBE_COLUMNS = ["youtube_id", "start_s", "duration_s", "tune_id", "title", "kind", "video_title", "query", "instrument", "backing",
                   "verified", "notes", "set_id", "instruments", "ensemble", "setting"]
SESSION_COLUMNS = ["youtube_id", "video_title", "set_id", "position", "set_start_s", "set_end_s", "set_kind", "name", "tune_id", "title", "kind",
                   "match", "candidates", "start_s", "duration_s", "verified", "instruments", "ensemble", "setting", "notes"]
OUT = ML  # where the files are written (--to)
MIN_CONFIDENCE = 0.8  # album labels below this prior stay out of training until checked


def seconds(x: float) -> str:
    return f"{round(x, 1):g}"


def catalogue() -> dict[int, tuple[str, str]]:
    names = {}
    with gzip.open(ML / "data" / "catalog.jsonl.gz", "rt") as handle:
        for setting in map(json.loads, handle):
            names.setdefault(setting["tuneId"], (setting["title"], setting["kind"]))
    return names


def cut(source: dict, start: float, end: float, target: Path) -> bool:
    """Writes source seconds [start, end) to `target` once; False when the source audio can't be had."""
    if target.exists():
        return True
    try:
        audio = store.audio(source)
    except Exception:
        return False
    info = soundfile.info(str(audio))
    data, rate = soundfile.read(str(audio), dtype="float32", start=int(start * info.samplerate), frames=int((end - start) * info.samplerate))
    target.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(str(target), data, rate)
    return True


def rows(kind: str) -> list[dict]:
    return store.db().execute(
        "select g.*, s.id as source_id, s.external_id, s.title as source_title, s.channel, s.licence, s.storage_key, s.duration_s as source_duration_s, s.meta as source_meta "
        "from ml.segments g join ml.sources s on s.id = g.source_id where s.kind = %s order by s.id, g.position nulls last, g.start_s", (kind,)).fetchall()


def youtube(names: dict) -> tuple[int, int]:
    out, cut_now = [], 0
    for r in rows("youtube_video"):
        meta = r["source_meta"] or {}
        offset = float(meta.get("offset_s", 0))
        start, length = offset + r["start_s"], r["end_s"] - r["start_s"]
        title, kind = names.get(r["tune_id"], ("", ""))
        row = {"youtube_id": meta.get("video", r["external_id"]), "start_s": seconds(start), "duration_s": seconds(length),
               "tune_id": r["tune_id"] or "", "title": title, "kind": kind, "video_title": r["source_title"] or "", "query": meta.get("query", ""),
               "instrument": meta.get("instrument", ""), "backing": meta.get("backing", ""), "verified": r["verified"] or "", "notes": r["notes"] or "",
               "set_id": r["set_id"] or "", "instruments": r["instruments"] or "", "ensemble": r["ensemble"] or "", "setting": r["setting_tag"] or ""}
        out.append(row)
        clip = YOUTUBE / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"
        if r["verified"] == "yes" and not clip.exists() and r["storage_key"]:
            cut_now += cut({"id": r["source_id"], "storage_key": r["storage_key"]}, r["start_s"], r["end_s"], clip)
    write(OUT / "eval" / "youtube.csv", YOUTUBE_COLUMNS, out)
    return len(out), cut_now


def sessions(names: dict) -> tuple[int, int]:
    out, cut_now = [], 0
    for r in rows("youtube_full"):
        meta = r["meta"] or {}
        title, kind = names.get(r["tune_id"], ("", ""))
        row = {"youtube_id": r["external_id"], "video_title": r["source_title"] or "", "set_id": r["set_id"] or "", "position": r["position"] or "",
               "set_start_s": seconds(meta.get("set_start_s", r["start_s"])), "set_end_s": seconds(meta.get("set_end_s", r["end_s"])),
               "set_kind": meta.get("set_kind", ""), "name": meta.get("described", ""), "tune_id": r["tune_id"] or "", "title": title, "kind": kind,
               "match": meta.get("match", ""), "candidates": " ".join(map(str, meta.get("candidates", []))),
               "start_s": seconds(r["start_s"]), "duration_s": seconds(r["end_s"] - r["start_s"]), "verified": r["verified"] or "",
               "instruments": r["instruments"] or "", "ensemble": r["ensemble"] or "", "setting": r["setting_tag"] or "", "notes": r["notes"] or ""}
        out.append(row)
        clip = YOUTUBE / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"
        if r["verified"] == "yes" and not clip.exists() and r["storage_key"]:
            cut_now += cut({"id": r["source_id"], "storage_key": r["storage_key"]}, r["start_s"], r["end_s"], clip)
    write(OUT / "eval" / "sessions.csv", SESSION_COLUMNS, out)
    return len(out), cut_now


def albums() -> int:
    roles = store.roles()
    # The bands set's tunes are eval too (store_import.roles), but keep their own valid/test split, not "benchmark".
    bands = {row["tune_id"] for row in store.db().execute("select tune_id from ml.tune_roles where reason like 'bands set:%'")}
    out = []
    for r in rows("album"):
        meta = r["source_meta"] or {}
        if not r["storage_key"] or r["verified"] == "no" or r["tune_id"] is None:
            continue
        confidence = 1.0 if r["verified"] == "yes" else r["confidence"]
        if confidence < MIN_CONFIDENCE:
            continue
        audio = Path(r["storage_key"]).name
        # A section trimmed in the labeller is cut to exactly the labelled stretch.
        if r["start_s"] > 0.05 or r["end_s"] < (r["source_duration_s"] or r["end_s"]) - 0.05:
            audio = f"{Path(audio).stem}.{seconds(r['start_s'])}-{seconds(r['end_s'])}.wav"
            if not cut({"id": r["source_id"], "storage_key": r["storage_key"]}, r["start_s"], r["end_s"], FOUND / "audio" / audio):
                continue
        video_start = float(meta.get("video_start_s", 0))
        role = roles.get(r["tune_id"])
        out.append({"tune_id": r["tune_id"], "audio": f"audio/{audio}", "video_id": meta.get("video"), "channel": r["channel"],
                    "start_s": video_start + r["start_s"], "end_s": video_start + r["end_s"], "confidence": confidence,
                    "label_source": "human" if r["verified"] == "yes" else r["label_source"], "licence": r["licence"],
                    "split": split_of(r["tune_id"]) if r["tune_id"] in bands else "benchmark" if role == "eval"
                    else "train" if role == "train" else split_of(r["tune_id"])})
    (OUT / "data" / "found").mkdir(parents=True, exist_ok=True)
    with (OUT / "data" / "found" / "manifest.jsonl").open("w") as handle:
        for row in out:
            handle.write(json.dumps(row) + "\n")
    return len(out)


def write(path: Path, columns: list[str], out: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, columns)
        writer.writeheader()
        writer.writerows(out)


def main() -> None:
    global OUT
    parser = argparse.ArgumentParser()
    parser.add_argument("--to", type=Path, default=ML, help="write the files under this folder instead, to compare them first")
    OUT = parser.parse_args().to
    names = catalogue()
    print("youtube.csv: %d rows, %d clips cut" % youtube(names))
    print("sessions.csv: %d rows, %d clips cut" % sessions(names))
    print(f"manifest.jsonl: {albums()} album sections")


if __name__ == "__main__":
    main()
