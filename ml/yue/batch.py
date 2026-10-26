"""Renders a JSONL of YuE2 requests with the model loaded once (runs on the GPU box).

Uses the yue2-music instrumental skill's own score compiler, validation and pinned
pipeline, so each clip is what `instrumental.py run --composer agent` would make, minus
the per-clip model load. Writes 16 kHz mono Opus and one index line per clip; reruns skip
clips already rendered. --shard takes one or more shards (0/8,2/8), worked through in
turn. A 24 GB card holds two of these processes; a third runs out of memory.

    cd /workspace/yue/skill && .venv/bin/python /workspace/batch.py /workspace/train.jsonl /workspace/train-out --shard 0/8,2/8
"""

import argparse
import hashlib
import json
import random
import subprocess
import sys
import time
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path.cwd() / "scripts"))

from compile_score import compile_events  # noqa: E402
from instrumental import lyric_tags, open_pipeline, validate_request, validate_score  # noqa: E402

CONDITIONS = ("no vocals", "no singing", "no choir", "no spoken words")


def make_request(row: dict) -> dict:
    """The request `instrumental.py prepare` builds from events and a style."""
    text, _ = compile_events(row["events"])
    score = validate_score(text)
    style = row["style"].strip().rstrip(".,")
    for condition in CONDITIONS:
        if condition not in style.lower():
            style += ", " + condition
    request = dict(id=row["name"], style=style + ".", lyrics=lyric_tags(text), abc=text,
                   cot="full" if score.voices["Vocal"].chords else "melody", seed=row["seed"])
    validate_request(request)
    return request


def save(audio, path: Path) -> None:
    """48 kHz stereo float → 16 kHz mono Opus for training, plus a full-quality AAC copy for the web."""
    raw = audio.astype("float32")
    raw = raw.T if raw.shape[0] == 2 else raw
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", str(raw.shape[1] if raw.ndim == 2 else 1),
                    "-i", "pipe:", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "48k", str(path),
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(path.with_suffix(".m4a"))],
                   input=raw.tobytes(), check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("requests", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--shard", default="0/1")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    import torch

    with open_pipeline(Namespace(models_root=Path("models"), offline=True, device="cuda:0")) as pipe:
        for shard in args.shard.split(","):
            index, count = (int(x) for x in shard.split("/"))
            done = {row["name"] for path in args.out.glob("index-*.jsonl") for row in map(json.loads, path.open()) if row["status"] == "ok"}
            rows = [json.loads(line) for i, line in enumerate(args.requests.open()) if i % count == index]
            rows = [row for row in rows if row["name"] not in done]
            print(f"shard {shard}: {len(rows)} to render", flush=True)
            with (args.out / f"index-{index}.jsonl").open("a") as handle:
                for row in rows:
                    entry = render_one(pipe, row, args.out, torch)
                    handle.write(json.dumps(entry) + "\n")
                    handle.flush()
                    print(f"{row['name']} {entry['status']} {entry['elapsed']}s", flush=True)


def events_hash(events: dict) -> str:
    """Fingerprint of the notes a clip was made from, so a clip from rebuilt notes can be told apart."""
    return hashlib.sha1(json.dumps(events, sort_keys=True).encode()).hexdigest()[:12]


def render_one(pipe, row: dict, out: Path, torch) -> dict:
    start = time.time()
    entry = {"name": row["name"], "tune_id": row["tune_id"], "setting_id": row["setting_id"], "style": row["style"],
             "events": events_hash(row["events"])}
    for attempt in range(5):
        try:
            song = pipe(**make_request(row))
            save(song.audio, out / f"{row['name']}.ogg")
            truncated = song.truncated.values() if isinstance(song.truncated, dict) else [song.truncated]
            entry.update(status="ok", seconds=round(max(song.audio.shape) / 48000, 2), truncated=any(truncated))
            break
        except torch.cuda.OutOfMemoryError as error:  # the other process on the card peaked; wait and retry
            torch.cuda.empty_cache()
            time.sleep(5 + 10 * random.random())
            entry.update(status="failed", error=f"OutOfMemoryError after {attempt + 1} tries: {error}"[:300])
        except Exception as error:  # one bad score must not stop the batch
            entry.update(status="failed", error=f"{type(error).__name__}: {error}"[:300])
            break
    entry["elapsed"] = round(time.time() - start, 1)
    return entry


if __name__ == "__main__":
    main()
