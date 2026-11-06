"""Whole album tracks for the labeller, in place of the 30 s found sections (2026-11-04).

found/ only kept the stretches it could label alone: the first tune from the start of a track, the last from its end.
A set's middle tunes were never cut, so they could not be labelled. This gives each track one source holding its whole
audio, and moves the sections' segments onto it at their place in the track, with an unnamed segment for each gap
between them. The labeller then names the middle tunes and moves the boundaries (apps/web/src/lib/labels.ts).

    uv run --group store python store_tracks.py fetch [--cookies-from-browser chrome]   # data/found/tracks/{video}.ogg
    uv run --group store python store_tracks.py merge                 # dry run: what would change
    uv run --group store python store_tracks.py merge --apply         # snapshot, upload, move segments
    uv run --with onnxruntime python eval/prelabel_sessions.py --set tracks --engines tunebook

Each section's source stays, marked status "merged" with meta.merged_into, and its segments keep their ids and labels.
store_import.py found() skips merged sections, so a rerun cannot bring their segments back. store_export.py needs no
change: it cuts each labelled stretch out of its source's audio. The audio stays on our own machines and in the private
bucket for research, like the sections were.
"""

import argparse
import json
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from psycopg.types.json import Jsonb

from tunebook_ml import store

ML = Path(__file__).resolve().parent
TRACKS = ML / "data" / "found" / "tracks"
PREFIX = "ml/audio/album-track/"
GAP = 1.0  # seconds between two labels that become an unnamed segment


def album_sources() -> list[dict]:
    # 30 s sections only: a whole track (named by its video, as this script and found/ make them) is never merged again.
    return store.db().execute("select * from ml.sources where kind = 'album' and coalesce(status, '') <> 'merged' "
                              "and meta ? 'video' and meta ? 'video_start_s' and external_id <> meta->>'video' order by id").fetchall()


def fetch_one(video: str, cookies: list[str]) -> str | None:
    target = TRACKS / f"{video}.ogg"
    if target.exists():
        return None
    raw = target.with_suffix(".download")
    result = subprocess.run(["yt-dlp", "-q", *cookies, "--no-playlist", "-f", "bestaudio", "--force-overwrites", "-o", str(raw),
                             f"https://www.youtube.com/watch?v={video}"], capture_output=True, text=True, timeout=600)
    if result.returncode or not raw.exists():
        raw.unlink(missing_ok=True)
        return result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "no output"
    converted = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "16000", "-c:a", "libopus",
                                "-b:a", "48k", str(target)], capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    return converted.stderr.strip() or "ffmpeg failed" if converted.returncode else None


def fetch(args) -> None:
    TRACKS.mkdir(parents=True, exist_ok=True)
    videos = list(dict.fromkeys(s["meta"]["video"] for s in album_sources()))
    todo = [v for v in videos if not (TRACKS / f"{v}.ogg").exists()]
    cookies = ["--cookies-from-browser", args.cookies] if args.cookies else []
    print(f"{len(videos)} tracks, {len(todo)} to fetch", flush=True)
    failed, started = {}, time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        for n, (video, error) in enumerate(zip(todo, pool.map(lambda v: fetch_one(v, cookies), todo)), 1):
            if error:
                failed[video] = error
                print(f"{video}: {error}", flush=True)
            if n % 50 == 0:
                print(f"{n}/{len(todo)}, {len(failed)} failed, {(time.time() - started) / 60:.0f} min", flush=True)
    (TRACKS / "failed.json").write_text(json.dumps(failed, indent=1))
    print(f"done: {sum(1 for _ in TRACKS.glob('*.ogg'))} tracks on disk, {len(failed)} failed (failed.json)")


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout)


def plan(sources: list[dict], length: float) -> list[dict] | str:
    """The track's segments in order, in track seconds: each section's segments moved by its start in the video,
    overlaps trimmed, and an unnamed segment wherever two labels leave a gap. A string when it can't be done."""
    moved = []
    for s in sources:
        offset = float(s["meta"]["video_start_s"])
        for g in store.db().execute("select * from ml.segments where source_id = %s order by start_s", (s["id"],)).fetchall():
            moved.append({"id": g["id"], "section": s["external_id"], "start": offset + g["start_s"], "end": min(length, offset + g["end_s"]),
                          "tune": g["tune_id"], "verified": g["verified"]})
    moved.sort(key=lambda m: m["start"])
    for previous, current in zip(moved, moved[1:]):
        current["start"] = max(current["start"], previous["end"])
    if not moved or any(m["end"] - m["start"] < 1 for m in moved):
        return "sections overlap or fall outside the track"
    out = []
    for m in moved:
        if out and m["start"] - out[-1]["end"] > GAP:
            out.append({"id": None, "start": out[-1]["end"], "end": m["start"], "tune": None, "verified": None})
        out.append(m)
    return out


def merge(args) -> None:
    by_video: dict[str, list[dict]] = {}
    for s in album_sources():
        by_video.setdefault(s["meta"]["video"], []).append(s)
    if args.apply:
        snapshot = ML / "scratch" / f"album-before-tracks-{time.strftime('%Y%m%d-%H%M%S')}.json"
        ids = [s["id"] for group in by_video.values() for s in group]
        rows = {"sources": store.db().execute("select * from ml.sources where id = any(%s)", (ids,)).fetchall(),
                "segments": store.db().execute("select * from ml.segments where source_id = any(%s)", (ids,)).fetchall()}
        snapshot.write_text(json.dumps(rows, default=str))
        print(f"snapshot: {snapshot} ({len(rows['sources'])} sources, {len(rows['segments'])} segments)")
    merged = gaps = moved = 0
    skipped: dict[str, list[str]] = {}
    for video, sections in by_video.items():
        audio = TRACKS / f"{video}.ogg"
        if not audio.exists():
            skipped.setdefault("no track audio", []).append(video)
            continue
        length = duration(audio)
        segments = plan(sections, length)
        if isinstance(segments, str):
            skipped.setdefault(segments, []).append(video)
            continue
        merged += 1
        gaps += sum(1 for s in segments if s["id"] is None)
        moved += sum(1 for s in segments if s["id"] is not None)
        if not args.apply:
            continue
        first = sections[0]
        key = PREFIX + audio.name
        store.put_audio(audio, key)
        local = store.CACHE / key  # export cuts from this copy instead of fetching it back
        local.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(audio, local)
        meta = {k: first["meta"].get(k) for k in ("video", "album", "artist", "recording_id", "track", "set_size")}
        meta.update(video_start_s=0, names=[s["meta"].get("name") for s in sorted(sections, key=lambda s: s["meta"]["video_start_s"])],
                    sections=[s["external_id"] for s in sections])
        track = store.upsert_source("album", video, key, title=first["title"], channel=first["channel"], duration_s=length,
                                    licence=first["licence"], status="ok", meta=Jsonb(meta))
        with store.db().transaction():
            for position, s in enumerate(segments, 1):
                if s["id"] is None:
                    store.db().execute(
                        "insert into ml.segments (source_id, start_s, end_s, tune_id, set_id, position, label_source, confidence, origin) "
                        "values (%s, %s, %s, null, %s, %s, 'gap', 0, 'store_tracks.py')", (track, round(s["start"], 1), round(s["end"], 1), video, position))
                else:
                    store.db().execute(
                        "update ml.segments set source_id = %s, start_s = %s, end_s = %s, tune_id = %s, set_id = %s, position = %s, updated_at = now() "
                        "where id = %s", (track, round(s["start"], 1), round(s["end"], 1), s["tune"], video, position, s["id"]))
            for s in sections:
                store.db().execute("update ml.sources set status = 'merged', meta = meta || %s, updated_at = now() where id = %s",
                                   (Jsonb({"merged_into": track}), s["id"]))
    print(f"{'merged' if args.apply else 'would merge'} {merged} tracks: {moved} segments moved, {gaps} unnamed gaps added")
    for reason, videos in skipped.items():
        print(f"  skipped, {reason}: {len(videos)} ({', '.join(videos[:5])}{'…' if len(videos) > 5 else ''})")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--workers", type=int, default=4)
    f.add_argument("--cookies-from-browser", dest="cookies", help="browser whose YouTube sign-in yt-dlp should use (as found/ does)")
    m = sub.add_parser("merge")
    m.add_argument("--apply", action="store_true", help="snapshot, upload and move the segments (default: report only)")
    args = parser.parse_args()
    (fetch if args.command == "fetch" else merge)(args)


if __name__ == "__main__":
    main()
