"""Finds real recordings of catalog tunes on YouTube and labels where each tune is played.

Two harvesters, both writing to the found-songs database:

- `albums`: The Session's recordings (commercial albums, track by track, tunes in playing
  order). Each track is searched as "artist + first tune"; a result counts only when the
  artist and the first tune both check out, which the album metadata of YouTube's
  auto-generated "Topic" uploads makes reliable.
- `titles`: popular tunes searched by name, labelled from video titles (less reliable).

Without timestamps only the start of a track (the first tune) and its end (the last tune)
are safe to label. Chapters or a timestamped tracklist in the description label the rest.
"""

import csv
import io
import json
import re
import subprocess
import time
from collections import defaultdict

from found.db import ROOT, connect, now
from found.names import display, download, key, mentions, normalise, popularity, read_set, tunes

SEGMENT = 30.0
LEAD_IN = 3.0   # albums start almost at once; skip count-ins and fades
TAIL = 8.0      # and the final chord or fade-out
TIMESTAMP = re.compile(r"^\s*[\[(]?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[\])]?\s*[-–—.:)]*\s*(.+?)\s*$")
ARTIST_PREFIX = re.compile(r"^[^/|]+?\s[-–—:]\s")
EXCLUDE = re.compile(r"\b(lesson|tutorial|how to|learn|slow|backing track|play along|karaoke|lyrics|sheet music|midi|abc)\b", re.I)


class Harvester:
    def __init__(self, cookies: str | None = None, pause: float = 1.0, include_benchmark: bool = False):
        self.db = connect()
        self.cookies = ["--cookies-from-browser", cookies] if cookies else []
        self.pause = pause
        with (ROOT / "eval" / "youtube.csv").open() as handle:
            rows = list(csv.DictReader(handle))
        self.benchmark = {row["youtube_id"] for row in rows}
        # Benchmark tunes are left out, so real-clip scores stay a test of tunes never heard really played.
        self.skip = set() if include_benchmark else {int(row["tune_id"]) for row in rows if row["tune_id"].isdigit()}

    def yt_dlp(self, *args: str) -> dict | None:
        time.sleep(self.pause)
        result = subprocess.run(["yt-dlp", *self.cookies, *args], capture_output=True, text=True, timeout=180)
        if result.returncode:
            if "confirm you" in result.stderr:
                raise SystemExit("YouTube wants a signed-in browser: rerun with --cookies-from-browser chrome (or firefox, safari)")
            return None
        return json.loads(result.stdout)

    def search(self, query: str, harvester: str, count: int = 6) -> list[dict]:
        if self.db.execute("select 1 from searches where query = ?", (query,)).fetchone():
            return []
        found = self.yt_dlp("--flat-playlist", "-J", f"ytsearch{count}:{query}")
        entries = [entry for entry in (found or {}).get("entries") or [] if entry.get("id")]
        self.db.execute("insert into searches values (?, ?, ?, ?)", (query, harvester, len(entries), now()))
        self.db.commit()
        return entries

    def video(self, video_id: str) -> dict | None:
        row = self.db.execute("select * from videos where id = ?", (video_id,)).fetchone()
        if row is None:
            # Skipping the player script keeps the metadata and makes this about 5x faster.
            meta = self.yt_dlp("-J", "--skip-download", "--no-playlist", "--extractor-args", "youtube:player_skip=js",
                               f"https://www.youtube.com/watch?v={video_id}")
            values = {
                "id": video_id, "status": "ok" if meta else "unavailable", "fetched_at": now(),
                **({
                    "title": meta.get("title"), "channel": meta.get("channel") or meta.get("uploader"),
                    "duration_s": meta.get("duration"), "licence": meta.get("license"), "album": meta.get("album"),
                    "artist": meta.get("artist") or meta.get("creator"), "description": meta.get("description"),
                    "chapters": json.dumps(meta.get("chapters")) if meta.get("chapters") else None,
                    "upload_date": meta.get("upload_date"),
                } if meta else {}),
            }
            self.db.execute(f"insert into videos ({', '.join(values)}) values ({', '.join('?' * len(values))})", list(values.values()))
            self.db.commit()
            row = self.db.execute("select * from videos where id = ?", (video_id,)).fetchone()
        return dict(row) if row["status"] == "ok" else None

    def add(self, video: dict, start: float, end: float, tune_id: int, name: str, source: str, confidence: float, **extra) -> bool:
        start, end = max(0.0, start), min(end, video["duration_s"] or end)
        if end - start < 10 or tune_id not in tunes():
            return False
        cursor = self.db.execute(
            "insert or ignore into found (video_id, start_s, end_s, tune_id, name, label_source, confidence, added_at, position, set_size, recording_id, track)"
            " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (video["id"], round(start, 1), round(end, 1), tune_id, name, source, confidence, now(),
             extra.get("position"), extra.get("set_size"), extra.get("recording_id"), extra.get("track")))
        self.db.commit()
        return cursor.rowcount > 0

    def add_set(self, video: dict, pieces: list[tuple[str, int | None]], source: str, confidence: float, **extra) -> int:
        """Labels the first and last tune of a set from its start and end."""
        duration, added = video["duration_s"] or 0, 0
        first_name, first_id = pieces[0]
        if first_id:
            added += self.add(video, LEAD_IN, LEAD_IN + SEGMENT, first_id, first_name, source, confidence, position=1, set_size=len(pieces), **extra)
        last_name, last_id = pieces[-1]
        if len(pieces) == 1 and first_id and duration > 2 * SEGMENT + LEAD_IN + TAIL:
            # A single tune played through: its end is another, later-in-the-tune example.
            added += self.add(video, duration - TAIL - SEGMENT, duration - TAIL, first_id, first_name, source, confidence, position=1, set_size=1, **extra)
        elif len(pieces) > 1 and last_id and duration > max(len(pieces) * 25, 2 * SEGMENT + LEAD_IN + TAIL):
            added += self.add(video, duration - TAIL - SEGMENT, duration - TAIL, last_id, last_name, source, confidence - 0.1, position=len(pieces), set_size=len(pieces), **extra)
        return added + self.add_timestamps(video)

    def add_timestamps(self, video: dict) -> int:
        """Labels every tune of a video whose chapters or description give start times."""
        marks: list[tuple[float, str, str]] = []
        for chapter in json.loads(video["chapters"] or "[]"):
            marks.append((chapter["start_time"], chapter["title"], "chapters"))
        if not marks:
            for line in (video["description"] or "").splitlines():
                if match := TIMESTAMP.match(line):
                    hours, minutes, seconds, text = match.groups()
                    marks.append((int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds), text, "description"))
        marks.sort()
        added = 0
        for index, (start, text, source) in enumerate(marks):
            pieces = read_set(text)
            # Only a mark that names exactly one tune, and nothing else, is a clean label.
            if len(pieces) != 1 or not pieces[0][1] or len(marks) < 2:
                continue
            end = marks[index + 1][0] if index + 1 < len(marks) else video["duration_s"] or start + SEGMENT
            if end - start >= 20:
                added += self.add(video, start + LEAD_IN, min(start + LEAD_IN + SEGMENT, end - 2), pieces[0][1][0], pieces[0][0], source, 0.8)
        return added


def album_tracks() -> list[dict]:
    """The Session's album tracks: {recording_id, recording, artist, track, tunes: [(name, id)]}."""
    tracks: dict[tuple[int, int], dict] = {}
    for row in csv.DictReader(io.StringIO(download("recordings"))):
        track = tracks.setdefault((int(row["id"]), int(row["track"])), {
            "recording_id": int(row["id"]), "recording": row["recording"], "artist": row["artist"], "track": int(row["track"]), "tunes": [],
        })
        track["tunes"].append((int(row["number"]), row["tune"], int(row["tune_id"]) if row["tune_id"].isdigit() else None))
    for track in tracks.values():
        track["tunes"] = [(name, tune_id) for _, name, tune_id in sorted(track["tunes"])]
    return list(tracks.values())


def harvest_albums(harvester: Harvester, limit: int, per_tune: int) -> None:
    known, rank = tunes(), popularity()
    counts = defaultdict(int, harvester.db.execute("select tune_id, count(*) from found group by tune_id").fetchall())
    tracks = [track for track in album_tracks() if track["tunes"][0][1] in known and key(track["artist"])]
    tracks.sort(key=lambda track: -rank.get(track["tunes"][0][1], 0))
    searched = 0
    for track in tracks:
        if searched >= limit:
            break
        first_name, first_id = track["tunes"][0]
        if counts[first_id] >= per_tune or first_id in harvester.skip:
            continue
        query = f"{track['artist']} {display(first_name)}"
        entries = harvester.search(query, "albums")
        if not entries:
            continue
        searched += 1
        artist = normalise(track["artist"])
        for entry in entries:
            if entry["id"] in harvester.benchmark or not 40 <= (entry.get("duration") or 0) <= 900:
                continue
            # Cheap checks on the search result before fetching its full metadata.
            channel = entry.get("channel") or entry.get("uploader") or ""
            if not mentions(entry.get("title") or "", first_name) or not (
                    channel.endswith(" - Topic") or f" {artist} " in f" {normalise(channel + ' ' + (entry.get('title') or ''))} "):
                continue
            video = harvester.video(entry["id"])
            if not video:
                continue
            context = normalise(" ".join(filter(None, [video["channel"], video["artist"], video["title"]])))
            same_album = video["album"] and normalise(video["album"]) == normalise(track["recording"])
            if f" {artist} " not in f" {context} " and not same_album:
                continue
            pieces = read_set(video["title"] or "")
            if not pieces or key(pieces[0][0]) != key(first_name):
                continue  # the title must open with this track's first tune
            added = harvester.add_set(video, track["tunes"], "album", 0.95 if same_album else 0.85,
                                      recording_id=track["recording_id"], track=track["track"])
            if added:
                counts[first_id] += 1
                print(f"{counts[first_id]} {display(first_name)} <- {video['channel']}: {video['title']} (+{added})")
                break


def harvest_titles(harvester: Harvester, limit: int, per_tune: int) -> None:
    known, rank = tunes(), popularity()
    counts = defaultdict(int, harvester.db.execute("select tune_id, count(*) from found group by tune_id").fetchall())
    styles = ["", "fiddle", "flute", "session", "accordion", "concertina", "banjo", "pipes", "whistle"]
    searched = 0
    for tune_id in sorted(set(known) - harvester.skip, key=lambda t: -rank.get(t, 0)):
        for style in styles:
            if searched >= limit or counts[tune_id] >= per_tune:
                break
            tune = known[tune_id]
            entries = harvester.search(f"{display(tune['title'])} {tune['kind'] or ''} {style} irish".replace("  ", " "), "titles")
            if not entries:
                continue
            searched += 1
            for entry in entries:
                title = entry.get("title") or ""
                if entry["id"] in harvester.benchmark or not 40 <= (entry.get("duration") or 0) <= 900 or EXCLUDE.search(title):
                    continue
                pieces = read_set(title)
                opening = next((index for index, (_, ids) in enumerate(pieces) if ids), None)
                # The tune must open the title, after at most an "Artist - " prefix.
                if opening is None or tune_id not in pieces[opening][1] or opening > (1 if ARTIST_PREFIX.search(title) else 0):
                    continue
                pieces = pieces[opening:]
                video = harvester.video(entry["id"])
                if not video or harvester.db.execute("select 1 from found where video_id = ?", (video["id"],)).fetchone():
                    continue
                # Only the opening tune is known; a closing tune is trusted when its name is unambiguous.
                labels = [(pieces[0][0], tune_id)] + [(name, ids[0] if len(ids) == 1 else None) for name, ids in pieces[1:]]
                added = harvester.add_set(video, labels, "title", 0.7)
                if added:
                    counts[tune_id] += 1
                    print(f"{counts[tune_id]} {display(tune['title'])} <- {video['channel']}: {title} (+{added})")
                    break
        if searched >= limit:
            break
