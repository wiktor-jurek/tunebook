"""Turns YuE2 renders of single settings into web play-alongs: AAC files plus a manifest.

Renders are named {tune}-s{setting}-{n} (yue/events.py --setting) or, for the first
Homer's test, {tune}-{n}. Labels come from each request's style prompt, or from
events.LINE_UPS when the request folder is gone. Then `bash yue/upload.sh` puts the files
in B2 under playalong/, and `npx tsx scripts/import-playalongs.ts` registers them.

    uv run python yue/playalong.py cache/yue/homer-out cache/yue/listen-out --requests cache/yue/homer cache/yue/listen
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

import soundfile

from events import LINE_UPS

ML = Path(__file__).resolve().parent.parent
OUT = ML / "cache" / "yue" / "playalong"
NAME = re.compile(r"^(?P<tune>\d+)(?:-s(?P<setting>\d+))?-(?P<version>\d+)$")
STYLE = re.compile(r", (?P<players>[^,]+?) playing the melody with (?P<backing>[^,]+?)(?: accompaniment)?, ")


def label(style: str | None, version: int) -> str:
    match = STYLE.search(style or "")
    players, backing = (match.group("players"), match.group("backing")) if match else LINE_UPS[version % len(LINE_UPS)]
    players = players[0].upper() + players[1:]
    return players if backing.startswith("no accompaniment") else f"{players} with {backing}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("renders", nargs="+", type=Path, help="folders of {name}.flac")
    parser.add_argument("--requests", nargs="*", type=Path, default=[], help="folders of {name}/events.json and style.txt")
    args = parser.parse_args()

    entries = {}
    manifest = OUT / "manifest.jsonl"
    if manifest.exists():
        entries = {row["storageKey"]: row for row in map(json.loads, manifest.open())}
    for folder in args.renders:
        for flac in sorted(folder.glob("*.flac")):
            match = NAME.match(flac.stem)
            if not match:
                continue
            tune, version = int(match["tune"]), int(match["version"])
            setting = int(match["setting"] or tune)  # the Homer's test used the tune's first setting
            request = next((folder / flac.stem for folder in args.requests if (folder / flac.stem).is_dir()), None)
            style = (request / "style.txt").read_text() if request and (request / "style.txt").exists() else None
            events = json.loads((request / "events.json").read_text()) if request and (request / "events.json").exists() else None
            key = f"playalong/{setting}/{flac.stem}.m4a"
            target = OUT / str(setting) / f"{flac.stem}.m4a"
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(flac), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(target)], check=True)
            entries[key] = {"settingId": setting, "tuneId": tune, "label": label(style, version), "bpm": events["bpm"] if events else None,
                            "durationMs": round(soundfile.info(flac).duration * 1000), "storageKey": key, "model": "YuE2-3B"}
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text("".join(json.dumps(entry) + "\n" for entry in entries.values()))
    for entry in entries.values():
        print(f"{entry['settingId']:6d} {entry['durationMs'] / 1000:5.1f}s {entry['label']}")


if __name__ == "__main__":
    main()
