"""What the labeller (/admin/label) loads beside each source, for those that have none yet:

- music-activity lanes (music_activity.py) for album sections, written beside the local audio, uploaded
  beside it in the bucket, and keyed in the source's meta (analysis_key);
- for whole sessions, each set's stretch of the recording with 10 s either side (as review.py cut them,
  in cache/youtube/source/), with its lane, keyed in meta.windows[set_id]: an hour of audio is too much
  for a browser to decode.

    uv run --group store python eval/analyse_sources.py
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import soundfile
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from music_activity import analyse  # noqa: E402

from tunebook_ml import store  # noqa: E402

ML = Path(__file__).resolve().parents[1]
LOCAL = {"album": ML / "data" / "found" / "audio", "youtube_full": ML / "cache" / "youtube" / "full"}
MARGIN = 10  # seconds either side of a set, as review.py showed it


def lane(audio: Path, key: str) -> str:
    """Analyses `audio` once (beside it) and uploads the lane next to its bucket key; returns the lane's key."""
    target = audio.with_suffix(".json")
    if not target.exists():
        target.write_text(json.dumps(analyse(audio)))
    lane_key = key.rsplit(".", 1)[0] + ".json"
    store.put_audio(target, lane_key)
    return lane_key


def windows() -> None:
    sessions = store.db().execute("select id, storage_key, meta from ml.sources where kind = 'youtube_full' and storage_key is not null").fetchall()
    for source in sessions:
        spans = defaultdict(list)
        for row in store.db().execute("select set_id, meta from ml.segments where source_id = %s and set_id is not null", (source["id"],)):
            meta = row["meta"] or {}
            if "set_start_s" in meta:
                spans[row["set_id"]].append((meta["set_start_s"], meta["set_end_s"]))
        full = LOCAL["youtube_full"] / source["storage_key"].rsplit("/", 1)[1]
        video = (source["meta"] or {}).get("video") or full.stem
        result = dict((source["meta"] or {}).get("windows") or {})
        for set_id, pairs in spans.items():
            if set_id in result:
                continue
            start, end = max(0.0, min(a for a, _ in pairs) - MARGIN), max(b for _, b in pairs) + MARGIN
            path = ML / "cache" / "youtube" / "source" / f"{video}.{start:g}-{end:g}.flac"
            if not path.exists():
                audio, rate = soundfile.read(full, dtype="float32", start=int(start * 16000), frames=int((end - start) * 16000))
                soundfile.write(path, audio, rate)
            key = f"ml/audio/youtube/source/{path.name}"
            store.put_audio(path, key)
            result[set_id] = {"key": key, "start_s": start, "end_s": end, "analysis_key": lane(path, key)}
        store.db().execute("update ml.sources set meta = coalesce(meta, '{}'::jsonb) || %s, updated_at = now() where id = %s",
                           (Jsonb({"windows": result}), source["id"]))
        print(f"{video}: {len(result)} set windows", flush=True)


def main() -> None:
    windows()
    todo = store.db().execute(
        "select id, kind, storage_key, meta from ml.sources where kind = 'album' "
        "and storage_key is not null and coalesce(meta->>'analysis_key', '') = '' order by kind, id").fetchall()
    print(f"{len(todo)} sources without a music-activity lane")
    for i, source in enumerate(todo):
        audio = LOCAL[source["kind"]] / source["storage_key"].rsplit("/", 1)[1]
        if not audio.exists():
            audio = store.audio(source)
        key = lane(audio, source["storage_key"])
        store.db().execute("update ml.sources set meta = coalesce(meta, '{}'::jsonb) || %s, updated_at = now() where id = %s",
                           (Jsonb({"analysis_key": key}), source["id"]))
        if i % 100 == 0:
            print(f"{i}/{len(todo)}", flush=True)
    print("done")


if __name__ == "__main__":
    main()
