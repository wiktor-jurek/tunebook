"""Turns YuE2 renders of single settings into web play-alongs: AAC files plus a manifest.

Renders are named {tune}-s{setting}-{n} (yue/events.py --setting) or, for the first
Homer's test, {tune}-{n}. Labels come from each request's style prompt, or from
events.LINE_UPS when the request folder is gone. Then `bash yue/upload.sh` puts the files
in B2 under playalong/, and `npx tsx scripts/import-playalongs.ts` registers them.

    uv run python yue/playalong.py cache/yue/homer-out cache/yue/listen-out --requests cache/yue/homer cache/yue/listen

Training clips with a web copy (batch.py writes {name}.m4a next to the training Opus) are
listed with --training into their own manifest; upload.sh puts them under yue/train/.

    uv run python yue/playalong.py --training
"""

import argparse
import gzip
import hashlib
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


# Prompt line-ups (events.SESSIONS, DUOS, SOLOISTS) in a few words for the player's buttons.
SHORT = [(re.compile(r"pub session"), "Pub session"), (re.compile(r"céilí band"), "Céilí band"), (re.compile(r"trad band"), "Trad band")]
NOISY = re.compile(r"crowd|chatter|audience", re.I)
TRAINING_STYLE = re.compile(r"Irish traditional [^,]+, (?P<players>.+?) playing the melody with (?P<backing>.+?)(?: accompaniment)?, (?P<feel>[^,]+), ")


def training_label(style: str) -> str | None:
    """Short label for a training clip, or None when the prompt asked for talk or a crowd over the tune."""
    match = TRAINING_STYLE.search(style)
    if not match or NOISY.search(style):
        return None
    players = match["players"].removesuffix(" in unison")
    players = next((short for pattern, short in SHORT if pattern.search(players)), players)
    players = re.sub(r",? and ", " & ", players) if "," not in players or players.count(",") == 1 else players
    players = players[0].upper() + players[1:]
    backing = match["backing"]
    return players if backing == "no" or backing.startswith("no accompaniment") else f"{players} with {backing}"


def events_hash(events: dict) -> str:
    """The fingerprint batch.py stores with each clip (batch.events_hash; batch.py needs YuE2 to import)."""
    return hashlib.sha1(json.dumps(events, sort_keys=True).encode()).hexdigest()[:12]


def chord_bug_settings() -> set[int]:
    """Settings whose old export was the chord track (no note had a score position); their clips play backing."""
    old = ML / "data" / "catalog-v1-chordbug.jsonl.gz"
    if not old.exists():
        return set()
    return {row["settingId"] for row in map(json.loads, gzip.open(old, "rt")) if all(char is None for char in row["chars"])}


def training(out: Path) -> None:
    requests = {row["name"]: row for row in map(json.loads, (ML / "cache" / "yue" / "train.jsonl").open())}
    broken = chord_bug_settings()
    before = ML / "cache" / "yue" / "train-before-retime.jsonl"
    retimed = {row["name"] for row in map(json.loads, before.open())
               if row["events"] != requests[row["name"]]["events"]} if before.exists() else set()
    entries, skipped = [], 0
    for box in sorted((ML / "data" / "yue" / "train").iterdir()):
        for index in sorted(box.glob("index-*.jsonl")):
            for row in map(json.loads, index.open()):
                clip = box / f"{row['name']}.m4a"
                if row["status"] != "ok" or not clip.exists() or row["name"] not in requests:
                    continue
                request = requests[row["name"]]
                name = training_label(request["style"])
                # Clips from before the notes were rebuilt with rests (yue/events.py --retime) are off time.
                stale = row.get("events") != events_hash(request["events"]) and row["name"] in retimed
                if name is None or request["setting_id"] in broken or stale:
                    skipped += 1
                    continue
                entries.append({"settingId": request["setting_id"], "tuneId": request["tune_id"], "label": name,
                                "bpm": request["events"]["bpm"], "durationMs": round(row["seconds"] * 1000),
                                "storageKey": f"yue/train/{box.name}/{clip.name}", "model": "YuE2-3B"})
    out.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
    print(f"{len(entries)} training play-alongs for {len({e['settingId'] for e in entries})} settings → {out}; {skipped} skipped (noisy prompt or chord bug)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("renders", nargs="*", type=Path, help="folders of {name}.flac")
    parser.add_argument("--requests", nargs="*", type=Path, default=[], help="folders of {name}/events.json and style.txt")
    parser.add_argument("--training", action="store_true", help="list training clips with web copies instead")
    args = parser.parse_args()
    if args.training:
        training(OUT / "training.jsonl")
        return

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
            if key in entries and request is None:
                continue  # listed earlier, from a request that is gone: keep its label and tempo
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
