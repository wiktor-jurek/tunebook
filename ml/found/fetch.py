"""Fetches each found track whole, as 16 kHz mono Opus (48 kbit/s), and puts it in the private bucket.

The download goes through data/found/tracks/ (store_tracks.py's folder, which keeps a copy for exports to cut from);
the bucket and the data home are where it lives. The audio stays on our own machines and in the private bucket for
research; it is never committed or redistributed.
"""

import shutil
from concurrent.futures import ThreadPoolExecutor

from psycopg.types.json import Jsonb

import store_tracks
from tunebook_ml import store


def fetch(limit: int, workers: int, cookies: str | None) -> None:
    """Every found track still without audio: download, upload, and mark the source ok (or unavailable)."""
    store_tracks.TRACKS.mkdir(parents=True, exist_ok=True)
    rows = store.db().execute(
        "select id, external_id from ml.sources where kind = 'album' and storage_key is null and external_id = meta->>'video' "
        "and coalesce(status, '') <> 'unavailable' order by id limit %s", (limit,)).fetchall()
    flags = ["--cookies-from-browser", cookies] if cookies else []
    with ThreadPoolExecutor(workers) as pool:
        for row, error in zip(rows, pool.map(lambda r: store_tracks.fetch_one(r["external_id"], flags), rows)):
            audio = store_tracks.TRACKS / f"{row['external_id']}.ogg"
            if error or not audio.exists():
                print(f"{row['external_id']}: {error or 'no audio'}")
                if error and ("unavailable" in error.lower() or "private" in error.lower()):
                    store.db().execute("update ml.sources set status = 'unavailable', meta = meta || %s, updated_at = now() where id = %s",
                                       (Jsonb({"fetch_error": error}), row["id"]))
                continue
            key = store_tracks.PREFIX + audio.name
            store.put_audio(audio, key)
            local = store.CACHE / key  # exports cut from this copy instead of fetching it back
            local.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(audio, local)
            store.db().execute("update ml.sources set storage_key = %s, duration_s = %s, status = 'ok', updated_at = now() where id = %s",
                               (key, store_tracks.duration(audio), row["id"]))
    print(f"{len(rows)} tracks tried")
