"""Local page for verifying benchmark labels; verdicts are written back to the CSVs.

For each YouTube clip it shows the first few minutes of the video as a waveform with a
music-activity lane (eval/music_activity.py) and a suggested clip past any talking, so
the clip can be trimmed before it's judged. Verdicts are yes, no, or set (several tunes:
skipped by the benchmarks until each tune is labelled).

    uv run python eval/review.py    # then open http://127.0.0.1:8765
"""

import csv
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import soundfile

from fetch_youtube import SOURCE_SECONDS, clip_path, fetch, fetch_source, source_path
from music_activity import SAMPLE_RATE, analyse

ROOT = Path(__file__).parent.parent
FILES = {"youtube": ROOT / "eval" / "youtube.csv", "reels50": ROOT / "eval" / "reels50_map.csv"}
EDITABLE = {"youtube": ("verified", "backing", "tune_id", "notes"), "reels50": ("verified", "tune_id")}
PREFETCH = 4  # sources fetched ahead of the clip being reviewed
lock = threading.Lock()
prefetcher = ThreadPoolExecutor(2)
fetching: dict[str, threading.Event] = {}
fetching_lock = threading.Lock()


def load(name: str) -> list[dict]:
    with FILES[name].open() as handle:
        return list(csv.DictReader(handle))


def save(name: str, rows: list[dict]) -> None:
    with FILES[name].open("w", newline="") as handle:
        writer = csv.DictWriter(handle, list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def ensure_source(row: dict) -> str:
    """Fetches a video's source audio once, even when the page and the prefetcher ask together."""
    key = row["youtube_id"]
    with fetching_lock:
        event = fetching.get(key)
        owner = event is None
        if owner:
            event = fetching[key] = threading.Event()
    if not owner:
        event.wait()
        return "cached" if source_path(row).exists() else "failed"
    try:
        return fetch_source(row)
    finally:
        event.set()
        with fetching_lock:
            fetching.pop(key, None)


def analysis(row: dict) -> dict:
    cached = source_path(row).with_suffix(".json")
    if cached.exists():
        return json.loads(cached.read_text())
    result = analyse(source_path(row))
    cached.write_text(json.dumps(result))
    return result


def cut_clip(row: dict) -> str:
    """Writes the row's clip from its cached source, or downloads it if the source doesn't cover it."""
    start, duration = float(row["start_s"]), float(row["duration_s"])
    source = source_path(row)
    if source.exists() and start + duration <= SOURCE_SECONDS:
        audio, rate = soundfile.read(source, dtype="float32")
        assert rate == SAMPLE_RATE, rate
        clip = audio[int(start * rate): int((start + duration) * rate)]
        if len(clip) >= int(duration * rate) - rate:  # the video may end a moment early
            clip_path(row).parent.mkdir(parents=True, exist_ok=True)
            soundfile.write(clip_path(row), np.ascontiguousarray(clip), rate)
            return "ok"
    return fetch(row)


class Handler(BaseHTTPRequestHandler):
    def send(self, status: int, body: bytes, kind: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value) -> None:
        self.send(200, json.dumps(value).encode(), "application/json")

    def do_GET(self) -> None:
        parts = urlparse(self.path).path.strip("/").split("/")
        if parts == [""]:
            return self.send(200, (ROOT / "eval" / "review.html").read_bytes(), "text/html; charset=utf-8")
        if parts[0] == "rows" and parts[1:2] and parts[1] in FILES:
            return self.send_json(load(parts[1]))
        if parts[0] == "prelabel" and parts[1:2]:
            # A reference model's per-window guesses over the source, written by an offline tool
            # next to the source as {id}.prelabel.json: {model, window, hop, windows: [{t, tune, name, cos}]}.
            path = source_path(load("youtube")[int(parts[1])]).with_suffix(".prelabel.json")
            if not path.exists():
                return self.send(404, b"No pre-label", "text/plain")
            return self.send(200, path.read_bytes(), "application/json")
        if parts[0] in ("source", "analysis") and parts[1:2]:
            rows = load("youtube")
            index = int(parts[1])
            for ahead in rows[index + 1: index + 1 + PREFETCH]:
                prefetcher.submit(ensure_source, ahead)
            status = ensure_source(rows[index])
            if status.startswith("failed"):
                return self.send(502, status.encode(), "text/plain")
            if parts[0] == "analysis":
                return self.send_json(analysis(rows[index]))
            return self.send(200, source_path(rows[index]).read_bytes(), "audio/flac")
        self.send(404, b"Not found", "text/plain")

    def do_POST(self) -> None:
        _, name, index = urlparse(self.path).path.strip("/").split("/")
        patch = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        with lock:
            rows = load(name)
            row = rows[int(index)]
            if name == "youtube" and ("start_s" in patch or "duration_s" in patch):
                old = clip_path(row)
                row["start_s"] = f"{float(patch.get('start_s', row['start_s'])):g}"
                row["duration_s"] = f"{float(patch.get('duration_s', row['duration_s'])):g}"
                if clip_path(row) != old or not old.exists():
                    status = cut_clip(row)
                    if status.startswith("failed"):
                        return self.send(502, status.encode(), "text/plain")
                    if clip_path(row) != old:
                        old.unlink(missing_ok=True)
            row.update({key: str(value) for key, value in patch.items() if key in EDITABLE[name]})
            save(name, rows)
        self.send_json(row)

    def log_message(self, *args) -> None:
        pass


if __name__ == "__main__":
    print("Review labels at http://127.0.0.1:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
