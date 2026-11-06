"""Whole pub sessions from SoundCloud, used with their uploaders' permission. Each is a soundcloud_full source in the
data home, registered with `add` and the permission recorded on it (meta.permission: who granted it, and when). Phone and room recordings of real sessions, talk and all: the noisy audio the YouTube
session videos lack, for measuring the finder where it fails (session_decode.py compare --kind soundcloud).

Unlike the YouTube sessions (eval/sessions.py), these come with no setlist. So the shipped finder listens through each
one as the app would (session_decode.py's decoder, with the switch view and the score floor) and proposes its sets: a
segment for each tune it names, an unnamed one for each stretch it could not explain (talk, or a tune it missed), cut
into sets of up to about ten minutes for the labeller (/admin/label, Sessions). The labeller names, moves or removes them.
A recording that already has segments keeps them.

    uv run --group store python eval/soundcloud.py add URL --permission "uploader, granted 2026-11-06"
    uv run --group store --group train --with onnxruntime python eval/soundcloud.py     # fetch, store, propose sets
    uv run --group store python eval/analyse_sources.py                                    # then cut the set windows
    yt-dlp --flat-playlist "scsearch50:irish session"                                      # finding more to ask about
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from session_decode import (  # noqa: E402
    MODEL,
    PRIOR,
    SOUNDCLOUD,
    Settings,
    model_session,
    popularity,
    replay,
    score_file,
)

from tunebook_ml import store  # noqa: E402

PREFIX = "ml/audio/soundcloud/full/"
# The decoder that proposes the sets: what the app ships (decode.ts), switch view and floor included.
SHIPPED = Settings(switch_window=8, switch_extra=0.06, floor=0.35)
LEAD = 10.0  # a tune starts about this long before the finder names it
LONGEST_TUNE = 240.0  # a named tune runs to the next, but not past this: what follows is probably talk
GAP = 20.0  # an unexplained stretch longer than this becomes an unnamed segment
SET_SECONDS = 600.0  # the labeller loads one set at a time, so sets stay near ten minutes


def external_id(url: str) -> str:
    """ "https://soundcloud.com/uploader/track" → "uploader.track": unique, and safe as a file name."""
    return ".".join(url.split("soundcloud.com/", 1)[1].strip("/").split("?")[0].split("/"))


def fetch(url: str, target: Path) -> dict:
    """The recording as 16 kHz mono FLAC (what session_decode.py scores), and its SoundCloud details."""
    info = json.loads(subprocess.run(["yt-dlp", "-q", "-j", url], capture_output=True, text=True, check=True).stdout)
    if not target.exists():
        raw = target.with_suffix(".download")
        subprocess.run(["yt-dlp", "-q", "-f", "bestaudio", "--force-overwrites", "-o", str(raw), url], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "16000", str(target)], check=True)
        raw.unlink(missing_ok=True)
    return info


def propose(added: list[tuple[float, int]], length: float) -> list[dict]:
    """The finder's names as segments covering the recording, in order: named tunes, and unnamed stretches between."""
    starts = []
    for t, _ in added:
        starts.append(max(0.0, t - LEAD, starts[-1] if starts else 0.0))
    named = [{"start": start, "end": min(start + LONGEST_TUNE, starts[i + 1] if i + 1 < len(starts) else length, length), "tune": tune}
             for i, (start, (_, tune)) in enumerate(zip(starts, added))]
    out, at = [], 0.0
    for segment in [*named, {"start": length, "end": length, "tune": None}]:
        if segment["start"] - at > GAP:
            # Unexplained: unnamed, in pieces no longer than a set.
            pieces = int(np.ceil((segment["start"] - at) / SET_SECONDS))
            step = (segment["start"] - at) / pieces
            out += [{"start": at + i * step, "end": at + (i + 1) * step, "tune": None} for i in range(pieces)]
        if segment["end"] > segment["start"]:
            out.append(segment)
        at = max(at, segment["end"])
    return out


def sets(segments: list[dict]) -> list[list[dict]]:
    """Consecutive segments grouped into sets of up to SET_SECONDS."""
    grouped: list[list[dict]] = []
    for segment in segments:
        if not grouped or segment["end"] - grouped[-1][0]["start"] > SET_SECONDS:
            grouped.append([])
        grouped[-1].append(segment)
    return grouped


def add(url: str, permission: str) -> None:
    """Registers a recording to fetch, with the permission to use it. Missing until the next run fetches it."""
    url, name = url.strip().split("?")[0], external_id(url)
    known = store.db().execute("select id from ml.sources where kind = 'soundcloud_full' and external_id = %s", (name,)).fetchone()
    if known:  # already fetched: only the permission changes
        store.db().execute("update ml.sources set meta = coalesce(meta, '{}'::jsonb) || %s, updated_at = now() where id = %s",
                           (Jsonb({"url": url, "permission": permission}), known["id"]))
    else:
        store.upsert_source("soundcloud_full", name, status="missing", meta=Jsonb({"url": url, "permission": permission}))
    print(f"{name}: {'permission updated' if known else 'registered'}")


def run() -> None:
    SOUNDCLOUD.mkdir(parents=True, exist_ok=True)
    tunes = json.loads((MODEL.parent / "tunes.json").read_text())
    counts = popularity()
    prior = (PRIOR * np.log(np.array([counts.get(t, 0) for t in tunes], dtype=np.float32) + 1)).astype(np.float32)
    session = None
    rows = store.db().execute("select external_id, meta from ml.sources where kind = 'soundcloud_full' order by id").fetchall()
    for row in rows:
        url, name = row["meta"]["url"], row["external_id"]
        if not row["meta"].get("permission"):
            print(f"{name}: no permission recorded, skipped")
            continue
        audio = SOUNDCLOUD / f"{name}.flac"
        info = fetch(url, audio)
        key = PREFIX + audio.name
        store.put_audio(audio, key)
        source = store.upsert_source(
            "soundcloud_full", name, key, title=info.get("title"), channel=info.get("uploader"), duration_s=info.get("duration"),
            licence=info.get("license"), status="ok", meta=Jsonb({"url": url, "uploader": info.get("uploader"),
                                                                  "upload_date": info.get("upload_date"), "description": info.get("description"), "offset_s": 0.0}))
        if store.db().execute("select 1 from ml.segments where source_id = %s limit 1", (source,)).fetchone():
            print(f"{name}: already has segments, kept")
            continue
        session = session or model_session(MODEL)
        data = np.load(score_file(audio, session))
        rec = {"idx": data["idx"], "val": data["val"].astype(np.float32), "quiet": data["quiet"]}
        length = float(info.get("duration") or len(rec["idx"]) + 8)
        proposed = sets(propose([(t, tunes[i]) for t, i in replay(rec, SHIPPED, prior)], length))
        with store.db().transaction():
            for n, group in enumerate(proposed, 1):
                set_id = f"{name}@{n}"
                meta = {"set_start_s": group[0]["start"], "set_end_s": group[-1]["end"]}
                for position, s in enumerate(group, 1):
                    store.db().execute(
                        "insert into ml.segments (source_id, start_s, end_s, tune_id, set_id, position, label_source, confidence, origin, meta) "
                        "values (%s, %s, %s, %s, %s, %s, %s, %s, 'eval/soundcloud.py', %s)",
                        (source, round(s["start"], 1), round(s["end"], 1), s["tune"], set_id, position,
                         "prelabel" if s["tune"] else "gap", 0.5 if s["tune"] else 0, Jsonb(meta)))
        named = sum(1 for g in proposed for s in g if s["tune"])
        print(f"{name}: {length / 60:.0f} min, {len(proposed)} sets, {named} tunes proposed, "
              f"{sum(len(g) for g in proposed) - named} unnamed stretches")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")
    a = sub.add_parser("add", help="register a recording you have permission to use")
    a.add_argument("url")
    a.add_argument("--permission", required=True, help="who granted it, and when")
    args = parser.parse_args()
    if args.command == "add":
        add(args.url, args.permission)
    else:
        run()


if __name__ == "__main__":
    main()
