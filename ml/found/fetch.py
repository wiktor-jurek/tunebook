"""Downloads each found section as 16 kHz mono Opus (48 kbit/s, about 190 KB) under data/found/audio.

Only the labelled sections are fetched, never whole videos. The audio stays on our own
machines for research; it is never committed or redistributed.
"""

import subprocess
from concurrent.futures import ThreadPoolExecutor

from found.db import DATA, connect

AUDIO = DATA / "audio"


def fetch_one(row: dict, cookies: list[str]) -> str | None:
    name = f"{row['video_id']}.{row['start_s']:g}-{row['end_s']:g}.ogg"
    target = AUDIO / name
    if target.exists():
        return name
    raw = target.with_suffix(".download")
    result = subprocess.run([
        "yt-dlp", "-q", *cookies, "--no-playlist", "-f", "bestaudio", "--download-sections", f"*{row['start_s']}-{row['end_s']}",
        "--force-overwrites", "-o", str(raw), f"https://www.youtube.com/watch?v={row['video_id']}",
    ], capture_output=True, text=True, timeout=300)
    if result.returncode or not raw.exists():
        print(f"{row['video_id']}: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'no output'}")
        return None
    converted = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-ac", "1", "-ar", "16000",
                                "-t", str(row["end_s"] - row["start_s"]), "-c:a", "libopus", "-b:a", "48k", str(target)], capture_output=True, text=True)
    raw.unlink(missing_ok=True)
    return name if not converted.returncode else None


def fetch(limit: int, workers: int, cookies: str | None) -> None:
    AUDIO.mkdir(parents=True, exist_ok=True)
    db = connect()
    rows = [dict(row) for row in db.execute(
        "select id, video_id, start_s, end_s from found where audio is null and coalesce(verified, '') != 'no' order by confidence desc, id limit ?", (limit,))]
    flags = ["--cookies-from-browser", cookies] if cookies else []
    with ThreadPoolExecutor(workers) as pool:
        for row, name in zip(rows, pool.map(lambda row: fetch_one(row, flags), rows)):
            if name:
                db.execute("update found set audio = ? where id = ?", (f"audio/{name}", row["id"]))
                db.commit()
    print(f"{sum(1 for _ in AUDIO.glob('*.ogg'))} sections on disk")
