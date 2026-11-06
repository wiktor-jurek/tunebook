"""One-time (rerunnable) import of the tune finder's scattered data into the ml schema (tunebook_ml/store.py).

    uv run --group store python store_import.py                 # tune roles
    uv run --group store python store_import.py --yue FILE      # also YuE2: a JSON list from yue/inventory.py (on mantis)

Since 2026-10-30 the YouTube and session labels are edited in the app (/admin/label), and eval/youtube.csv and
eval/sessions.csv are written from the data home by store_export.py. Importing them again would bring back
segments the labeller has since split or retimed, so that needs --from-label-csvs, for a deliberate restore.

Sources it reads, and what each becomes:
  eval/benchmark_split.json   tune_roles (with data/found/manifest.jsonl's valid/test tunes, the bands set)
  eval/youtube.csv            youtube_video sources (one per video) with a segment per clip, in video seconds
  eval/sessions.csv           youtube_full sources (one per video) with a segment per tune, in set order
The found songs (found/) were a local SQLite file until 2026-11-06, imported here; the harvester now writes the data
home itself (found/db.py). Reels50's map (eval/reels50_map.csv) names tunes in a text dataset, not audio, so it stays a CSV.
Segment times are seconds into the source's own audio file. Upserts throughout: a rerun changes nothing.
"""

import argparse
import csv
import json
from pathlib import Path

from psycopg.types.json import Jsonb

from tunebook_ml import store

ML = Path(__file__).resolve().parent
YOUTUBE = ML / "cache" / "youtube"
AUDIO = {".flac", ".wav", ".ogg", ".opus", ".m4a", ".webm", ".mp3"}


def key_if(path: Path, key: str) -> str | None:
    return key if path.exists() else None


def number(value: str) -> int | None:
    return int(value) if value and value.strip().isdigit() else None


def roles() -> int:
    split = json.loads((ML / "eval" / "benchmark_split.json").read_text())
    rows = [(t, "train", "benchmark train half (eval/benchmark_split.json)") for t in split["train"]]
    rows += [(t, "eval", "benchmark eval half (eval/benchmark_split.json)") for t in split["eval"]]
    # The found manifest's valid/test tunes are the "bands" test set (classifier.prepare); training never sees them.
    # The labeller ranks them first by this reason's prefix (apps/web/src/lib/labels.ts, BANDS_REASON).
    held = {int(r["tune_id"]) for r in map(json.loads, (ML / "data" / "found" / "manifest.jsonl").open()) if r["split"] in ("valid", "test")}
    rows += [(t, "eval", "bands set: found valid/test split (data/found/manifest.jsonl)") for t in sorted(held)]
    with store.db().cursor() as cursor:
        cursor.executemany("insert into ml.tune_roles (tune_id, role, reason) values (%s, %s, %s) on conflict do nothing", rows)
    return len(rows)


def media(path: Path, base: str) -> dict:
    """Keys of a source's analysis and engine prelabels in the bucket, when they sit beside its audio."""
    keys = {}
    if path.with_suffix(".json").exists():
        keys["analysis_key"] = f"{base}{path.with_suffix('.json').name}"
    prelabels = {engine: path.with_suffix(f".prelabel.{engine}.json") for engine in ("tunebook", "jigripper", "folkfriend")}
    if not prelabels["jigripper"].exists() and path.with_suffix(".prelabel.json").exists():
        prelabels["jigripper"] = path.with_suffix(".prelabel.json")  # JigRipper's timeline from before engines were named
    keys["prelabel_keys"] = {engine: f"{base}{p.name}" for engine, p in prelabels.items() if p.exists()}
    return keys


def youtube() -> int:
    """Each video's clips are segments, in seconds into the video, on one youtube_video source: the video's
    first minutes (cache/youtube/source, enough to trim against) or its whole recording. A clip running past
    those keeps its own file as the source, with `offset_s` saying where in the video it starts."""
    count = 0
    with (ML / "eval" / "youtube.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    for row in rows:
        video, start, length = row["youtube_id"], float(row["start_s"]), float(row["duration_s"])
        full = next((p for p in (YOUTUBE / "full").glob(f"{video}.*") if p.suffix in AUDIO), None)
        opening = YOUTUBE / "source" / f"{video}.flac"
        clip = YOUTUBE / f"{video}.{row['start_s']}-{row['duration_s']}.wav"
        if full:
            external, path, key, offset = video, full, f"ml/audio/youtube/full/{full.name}", 0.0
        elif opening.exists() and start + length <= 180:
            external, path, key, offset = video, opening, f"ml/audio/youtube/source/{opening.name}", 0.0
        elif clip.exists():
            external, path, key, offset = f"{video}@{row['start_s']}", clip, f"ml/audio/youtube/{clip.name}", start
        else:
            external, path, key, offset = video, None, None, 0.0
        base = key.rsplit("/", 1)[0] + "/" if key else ""
        source = store.upsert_source(
            "youtube_video", external, key, title=row["video_title"], status="ok" if key else "missing",
            meta=Jsonb({"video": video, "offset_s": offset, "query": row["query"], "instrument": row["instrument"],
                        "backing": row["backing"], **(media(path, base) if path else {})}))
        verified = row["verified"] or None
        store.upsert_segment(
            source, start - offset, number(row["tune_id"]), end_s=start - offset + length, set_id=row.get("set_id") or None,
            label_source="human" if verified else "title", confidence=1.0 if verified == "yes" else 0.7,
            verified=verified, instruments=row.get("instruments") or None, ensemble=row.get("ensemble") or None,
            setting_tag=row.get("setting") or None, notes=row["notes"] or None, origin="eval/youtube.csv")
        count += 1
    # The first import made one youtube_clip source per clip file; youtube_video replaces them.
    store.db().execute("delete from ml.sources where kind = 'youtube_clip'")
    return count


def sessions() -> int:
    path = ML / "eval" / "sessions.csv"
    if not path.exists():
        return 0
    with path.open() as handle:
        rows = list(csv.DictReader(handle))
    sources = {}
    for row in rows:
        video = row["youtube_id"]
        if video not in sources:
            full = next((p for p in (YOUTUBE / "full").glob(f"{video}.*") if p.suffix in AUDIO), None)  # not its prelabel .json
            sources[video] = store.upsert_source(
                "youtube_full", video, f"ml/audio/youtube/full/{full.name}" if full else None, title=row["video_title"],
                meta=Jsonb({"video": video, "offset_s": 0.0, **(media(full, "ml/audio/youtube/full/") if full else {})}))
        verified = row["verified"] or None
        start = float(row["start_s"])
        store.upsert_segment(
            sources[video], start, number(row["tune_id"]), end_s=start + float(row["duration_s"]), set_id=row["set_id"],
            position=number(row["position"]), label_source="human" if verified else "prelabel",
            confidence=1.0 if verified == "yes" else 0.5, verified=verified, instruments=row["instruments"] or None,
            ensemble=row["ensemble"] or None, setting_tag=row["setting"] or None, notes=row["notes"] or None, origin="eval/sessions.csv",
            meta=Jsonb({"described": row["name"], "match": row["match"], "candidates": [int(c) for c in row["candidates"].split() if c.isdigit()],
                        "set_start_s": float(row["set_start_s"]), "set_end_s": float(row["set_end_s"]), "set_kind": row["set_kind"]}))
    return len(rows)


def yue(path: Path) -> int:
    """YuE2 performances: [{"name", "box", "tune_id", "setting_id", "seconds", "seed", "bpm", "key"}], made on mantis
    by yue_inventory.py (the audio lives there and on B2 under yue/train/, the full requests under yue/requests/)."""
    items = json.loads(path.read_text())
    requests = {}  # the request files live on this machine, not with the audio
    for jsonl in sorted((ML / "cache" / "yue").glob("train*.jsonl")):
        for line in jsonl.open():
            request = json.loads(line)
            requests[request["name"]] = {"seed": request.get("seed"), "bpm": request["events"].get("bpm"), "key": request["events"].get("key")}
    for item in items:
        item.update({k: v for k, v in requests.get(item["name"], {}).items() if item.get(k) is None})
    # Batched: one row at a time to a remote database takes about an hour for 40k performances.
    with store.db().cursor() as cursor:
        cursor.executemany(
            "insert into ml.sources (kind, external_id, storage_key, duration_s, meta) values ('yue', %s, %s, %s, %s) "
            "on conflict (kind, external_id) do update set storage_key = excluded.storage_key, duration_s = excluded.duration_s, "
            "meta = excluded.meta, updated_at = now()",
            [(i["name"], f"yue/train/{i['box']}/{i['name']}.ogg", i["seconds"], Jsonb({k: i.get(k) for k in ("seed", "bpm", "key")})) for i in items])
        ids = {r["external_id"]: r["id"] for r in cursor.execute("select external_id, id from ml.sources where kind = 'yue'").fetchall()}
        cursor.executemany(
            "insert into ml.segments (source_id, start_s, end_s, tune_id, setting_id, label_source, confidence, origin) "
            "values (%s, 0, %s, %s, %s, 'generated', 1, 'yue/train') on conflict (source_id, start_s, tune_id) do nothing",
            [(ids[i["name"]], i["seconds"], i["tune_id"], i["setting_id"]) for i in items])
    return len(items)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yue", type=Path, help="YuE2 inventory JSON from mantis")
    parser.add_argument("--from-label-csvs", action="store_true", help="also import eval/youtube.csv and eval/sessions.csv (overwrites app labels)")
    args = parser.parse_args()
    print(f"tune roles: {roles()}")
    if args.from_label_csvs:
        print(f"youtube.csv: {youtube()} clips")
        print(f"sessions.csv: {sessions()} segments")
    if args.yue:
        print(f"yue: {yue(args.yue)} performances")
    for row in store.db().execute("select s.kind, count(distinct s.id) sources, count(g.id) segments, "
                                  "count(s.storage_key) filter (where g.id is not null) stored from ml.sources s "
                                  "left join ml.segments g on g.source_id = s.id group by 1 order by 1"):
        print(f"  {row['kind']:13} {row['sources']:6} sources {row['segments']:6} segments {row['stored']:6} with audio")


if __name__ == "__main__":
    main()
