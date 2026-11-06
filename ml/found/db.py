"""Where the found songs live: the data home (tunebook_ml/store.py) and the private bucket, nothing on local disk.

Each recording found is a whole album track: one `album` source named by its YouTube id (meta.video), holding the
audio once `python -m found fetch` has put it in the bucket, and a segment per labelled stretch in playing order,
with an unnamed segment wherever two labels leave a gap (the shape store_tracks.py gave the old 30 s sections).
The labeller (/admin/label, Album sections) names the gaps and moves the boundaries. Searches are kept in
ml.searches so none runs twice. Until 2026-11-06 all this was a local SQLite file, data/found.sqlite.
"""

from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from tunebook_ml import store

GAP = 1.0  # seconds between two labels that become an unnamed segment, as store_tracks.py


def now() -> datetime:
    return datetime.now(timezone.utc)


def searched(query: str) -> bool:
    return store.db().execute("select 1 from ml.searches where query = %s", (query,)).fetchone() is not None


def record_search(query: str, harvester: str, results: int) -> None:
    store.db().execute("insert into ml.searches (query, harvester, results, searched_at) values (%s, %s, %s, %s) on conflict do nothing",
                       (query, harvester, results, now()))


def has_video(video_id: str) -> bool:
    """Whether the video is already in the data home: as a whole track, a 30 s section of one, or a benchmark clip."""
    return store.db().execute("select 1 from ml.sources where (kind = 'album' and (external_id = %s or meta->>'video' = %s)) "
                              "or (kind in ('youtube_video', 'youtube_full') and external_id = %s) limit 1",
                              (video_id, video_id, video_id)).fetchone() is not None


def recordings_per_tune() -> dict[int, int]:
    """How many album recordings hold each tune (sections merged into their track count once, with the track)."""
    rows = store.db().execute("select g.tune_id, count(distinct s.id) n from ml.segments g join ml.sources s on s.id = g.source_id "
                              "where s.kind = 'album' and coalesce(s.status, '') <> 'merged' and g.tune_id is not null group by 1").fetchall()
    return {row["tune_id"]: row["n"] for row in rows}


def save_track(video: dict, labels: list[dict], **meta) -> int:
    """Writes a found track: its source (audio still to fetch) and its labelled stretches, gaps between them unnamed.
    `labels`: [{start, end, tune_id, name, label_source, confidence, set_position?, set_size?}]. Returns the labels written."""
    labels = sorted(labels, key=lambda label: label["start"])
    kept = []
    for label in labels:  # overlapping labels (a chapter inside the album label) keep the earlier one
        if not kept or label["start"] >= kept[-1]["end"] - 0.01:
            kept.append(label)
    if not kept:
        return 0
    source = store.upsert_source(
        "album", video["id"], None, title=video.get("title"), channel=video.get("channel"), duration_s=video.get("duration_s"),
        licence=video.get("licence"), status="missing",
        meta=Jsonb({"video": video["id"], "video_start_s": 0, "album": video.get("album"), "artist": video.get("artist"),
                    "description": video.get("description"), "chapters": video.get("chapters"), "upload_date": video.get("upload_date"),
                    **meta}))
    segments: list[dict] = []
    for label in kept:
        if segments and label["start"] - segments[-1]["end"] > GAP:
            segments.append({"start": segments[-1]["end"], "end": label["start"], "tune_id": None})
        segments.append(label)
    with store.db().transaction():
        for position, s in enumerate(segments, 1):
            named = s["tune_id"] is not None
            store.db().execute(
                "insert into ml.segments (source_id, start_s, end_s, tune_id, set_id, position, label_source, confidence, origin, meta) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, 'found', %s)",
                (source, round(s["start"], 1), round(s["end"], 1), s["tune_id"], video["id"], position,
                 s["label_source"] if named else "gap", s["confidence"] if named else 0,
                 Jsonb({k: s[k] for k in ("name", "set_position", "set_size") if s.get(k) is not None}) if named else None))
    return len(kept)
