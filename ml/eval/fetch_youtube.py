"""Downloads only each benchmark clip's section as 16 kHz mono WAV into cache/youtube/.

Clips are for local evaluation only and are never committed or redistributed.

    uv run python eval/fetch_youtube.py
"""

import csv
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).parent.parent
CACHE = ROOT / "cache" / "youtube"


def clip_path(row: dict) -> Path:
    return CACHE / f"{row['youtube_id']}.{row['start_s']}-{row['duration_s']}.wav"


SOURCE_SECONDS = 180


def source_path(row: dict) -> Path:
    return CACHE / "source" / f"{row['youtube_id']}.flac"


def fetch_source(row: dict) -> str:
    """The video's first few minutes, for choosing the clip in eval/review.py."""
    target = source_path(row)
    if target.exists():
        return "cached"
    target.parent.mkdir(parents=True, exist_ok=True)
    raw = target.with_suffix(".download")
    result = subprocess.run([
        "yt-dlp", "-q", "--no-playlist", "-f", "bestaudio", "--download-sections", f"*0-{SOURCE_SECONDS}",
        "-o", str(raw), f"https://www.youtube.com/watch?v={row['youtube_id']}",
    ], capture_output=True, text=True, timeout=300)
    if result.returncode or not raw.exists():
        return f"failed: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'no output'}"
    converted = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "16000", "-t", str(SOURCE_SECONDS), str(target)], capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    return "ok" if not converted.returncode else f"failed: {converted.stderr.strip()}"


def fetch(row: dict) -> str:
    target = clip_path(row)
    if target.exists():
        return "cached"
    start, end = float(row["start_s"]), float(row["start_s"]) + float(row["duration_s"])
    raw = target.with_suffix(".download")
    result = subprocess.run([
        "yt-dlp", "-q", "--no-playlist", "-f", "bestaudio", "--download-sections", f"*{start}-{end}",
        "-o", str(raw), f"https://www.youtube.com/watch?v={row['youtube_id']}",
    ], capture_output=True, text=True, timeout=300)
    if result.returncode or not raw.exists():
        return f"failed: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'no output'}"
    converted = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "16000", "-t", row["duration_s"], str(target)], capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    return "ok" if not converted.returncode else f"failed: {converted.stderr.strip()}"


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    with (ROOT / "eval" / "youtube.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    with ThreadPoolExecutor(4) as pool:
        for row, status in zip(rows, pool.map(fetch, rows)):
            if status != "cached":
                print(f"{row['youtube_id']} {row['title']}: {status}")


if __name__ == "__main__":
    main()
