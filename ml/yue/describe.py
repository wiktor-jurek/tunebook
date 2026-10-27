"""Asks Gemini what a YuE2 clip actually sounds like, without telling it what was asked for.

YuE2 doesn't always follow the instruments in its prompt (a "low whistle" can come out as a
pop synth lead), so the requested line-up is no guide to what a clip holds. Reads
GEMINI_API_KEY from the repository's .env.

    uv run python yue/describe.py cache/yue/listen-test/badger-lineups/*.m4a

Play-alongs go through the Batch API at half price: --batch uploads every clip the
manifests list (yue/playalong.py) that isn't described or waiting yet and submits one job;
--collect fetches finished jobs into cache/yue/playalong/descriptions.jsonl. playalong.py
then labels each clip by what was heard and drops clips with singing, talk or pop production.

    uv run python yue/describe.py --batch cache/yue/playalong/manifest.jsonl cache/yue/playalong/candidates.jsonl
    uv run python yue/describe.py --collect
"""

import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
API = "https://generativelanguage.googleapis.com"
MODEL = "gemini-3.8-flash"
THINKING = "medium"
MIME = {".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav", ".mp3": "audio/mp3"}
CACHE = ML / "cache" / "yue" / "playalong"
DESCRIPTIONS = CACHE / "descriptions.jsonl"
BATCHES = CACHE / "batches.jsonl"
UPLOADS = CACHE / "uploads.jsonl"
UPLOAD_HOURS = 44  # the Files API keeps uploads for 48 hours

PROMPT = """Listen to this instrumental recording and describe what you actually hear. Be literal and
specific; do not guess from what the music might be meant to be.

Answer as JSON with these fields:
- "instruments": every instrument you can hear, each {"name", "role" ("lead" | "backing" | "percussion"), "confidence" (0-1)}.
  Be precise about woodwinds and plucked strings: tin whistle vs low whistle vs flute vs synth lead,
  acoustic guitar vs bouzouki vs mandolin vs oud/saz/bouzouki-like Greek or Middle Eastern lutes.
- "genre": the genre it most sounds like, e.g. "Irish traditional", "Scottish", "Greek", "Middle Eastern", "pop", "EDM".
- "vibe": one sentence on the feel and production (e.g. "dry session recording", "polished pop production with reverb").
- "irish_trad": 1-5, how much this sounds like a real Irish/Scottish traditional music recording.
- "melody": is a clear single-line tune played throughout? "clear" | "intermittent" | "absent".
- "voices": every human voice, each {"kind", "start", "end"} with times as "m:ss", or [] when there are none.
  "kind" is "lilting" (wordless vocal mouth music following the tune), "singing" (sung words or
  a vocal melody), "talking" (speech) or "crowd" (audience or pub chatter, applause).
- "drums": any drum kit, electronic beats or bodhrán, or "none".
"""


def api_key() -> str:
    if key := os.environ.get("GEMINI_API_KEY"):
        return key
    for line in (ML.parent / ".env").read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("GEMINI_API_KEY is not set")


def call(url: str, data: bytes | None = None, headers: dict | None = None, raw: bool = False):
    """One API call, retried while the service is busy (503) or over a per-minute limit (429)."""
    request = urllib.request.Request(url, data=data, headers={"x-goog-api-key": api_key(), **(headers or {})})
    for attempt in range(6):
        try:
            response = urllib.request.urlopen(request, timeout=300)
            return response if raw else json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 503) or attempt == 5:
                raise RuntimeError(f"HTTP {error.code} {error.read()[:300]!r}") from None
            time.sleep(15 * 2 ** attempt)


def body(audio: dict) -> dict:
    return {"contents": [{"parts": [audio, {"text": PROMPT}]}],
            "generationConfig": {"responseMimeType": "application/json", "thinkingConfig": {"thinkingLevel": THINKING}}}


def parse(response: dict) -> dict:
    text = next(part["text"] for part in reversed(response["candidates"][0]["content"]["parts"]) if "text" in part)
    return {**json.loads(text), "usage": response.get("usageMetadata")}


def describe(path: Path, model: str = MODEL) -> dict:
    audio = {"inline_data": {"mime_type": MIME[path.suffix], "data": base64.b64encode(path.read_bytes()).decode()}}
    return parse(call(f"{API}/v1beta/models/{model}:generateContent", json.dumps(body(audio)).encode(), {"Content-Type": "application/json"}))


def upload(path: Path, mime: str) -> dict:
    data = path.read_bytes()
    start = call(f"{API}/upload/v1beta/files", json.dumps({"file": {"display_name": path.name}}).encode(), {
        "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "Content-Type": "application/json",
        "X-Goog-Upload-Header-Content-Length": str(len(data)), "X-Goog-Upload-Header-Content-Type": mime}, raw=True)
    return call(start.headers["x-goog-upload-url"], data, {"X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize"})["file"]


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open()] if path.exists() else []


def local_copy(storage_key: str) -> Path:
    """The file upload.sh sent to B2 under this key."""
    if storage_key.startswith("yue/train/"):
        return ML / "data" / "yue" / "train" / storage_key.removeprefix("yue/train/")
    return ML / "cache" / "yue" / storage_key


def submit(manifests: list[Path], model: str, workers: int) -> None:
    waiting = {key for batch in rows(BATCHES) if not batch.get("collected") for key in batch["keys"]}
    done = {row["storageKey"] for row in rows(DESCRIPTIONS) if row.get("model") == model} | waiting
    keys = [row["storageKey"] for manifest in manifests for row in rows(manifest)]
    keys = [key for key in dict.fromkeys(keys) if key not in done]
    if not keys:
        print("nothing new to describe")
        return
    fresh = time.time() - UPLOAD_HOURS * 3600
    uploads = {row["storageKey"]: row["uri"] for row in rows(UPLOADS) if row["at"] > fresh}

    def one(key: str) -> tuple[str, str]:
        if key in uploads:
            return key, uploads[key]
        path = local_copy(key)
        uri = upload(path, MIME[path.suffix])["uri"]
        with UPLOADS.open("a") as out:
            out.write(json.dumps({"storageKey": key, "uri": uri, "at": time.time()}) + "\n")
        return key, uri

    with ThreadPoolExecutor(workers) as pool:
        uris = dict(pool.map(one, keys))
    print(f"{len(keys)} clips uploaded", flush=True)
    jsonl = CACHE / f"batch-{int(time.time())}.jsonl"
    jsonl.write_text("".join(json.dumps({"key": key, "request": body({"file_data": {"mime_type": MIME[Path(key).suffix], "file_uri": uris[key]}})}) + "\n"
                             for key in keys))
    file = upload(jsonl, "application/jsonl")
    batch = call(f"{API}/v1beta/models/{model}:batchGenerateContent", json.dumps(
        {"batch": {"display_name": jsonl.stem, "input_config": {"file_name": file["name"]}}}).encode(), {"Content-Type": "application/json"})
    with BATCHES.open("a") as out:
        out.write(json.dumps({"name": batch["name"], "model": model, "keys": keys, "at": time.time()}) + "\n")
    print(f"submitted {batch['name']} with {len(keys)} clips")


def collect() -> None:
    batches = rows(BATCHES)
    for batch in batches:
        if batch.get("collected"):
            continue
        status = call(f"{API}/v1beta/{batch['name']}")
        state = status.get("metadata", {}).get("state") or status.get("state", "")
        print(batch["name"], state)
        if state.endswith(("FAILED", "CANCELLED", "EXPIRED")):
            batch["collected"] = state  # its clips go into the next --batch
        if not state.endswith("SUCCEEDED"):
            continue
        output = status.get("response") or status.get("metadata", {}).get("output") or {}
        name = output.get("responsesFile") or status.get("dest", {}).get("fileName")
        lines = call(f"{API}/download/v1beta/{name}:download?alt=media", raw=True).read().decode().splitlines()
        described = failed = 0
        with DESCRIPTIONS.open("a") as out:
            for row in map(json.loads, filter(None, lines)):
                try:
                    out.write(json.dumps({"storageKey": row["key"], "model": batch["model"], **parse(row["response"])}) + "\n")
                    described += 1
                except (KeyError, IndexError, StopIteration, ValueError):
                    failed += 1
        batch["collected"] = state
        print(f"{described} described, {failed} failed (they go into the next --batch)")
    BATCHES.write_text("".join(json.dumps(batch) + "\n" for batch in batches))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clips", nargs="*", type=Path)
    parser.add_argument("--batch", nargs="*", type=Path, help="submit every play-along these manifests list that isn't described yet")
    parser.add_argument("--collect", action="store_true", help="fetch finished batches into descriptions.jsonl")
    parser.add_argument("--workers", type=int, default=8, help="parallel uploads")
    parser.add_argument("--model", default=MODEL)
    args = parser.parse_args()
    if args.batch:
        submit(args.batch, args.model, args.workers)
    elif args.collect:
        collect()
    for clip in args.clips:
        print(json.dumps({"clip": clip.name, **describe(clip, args.model)}))


if __name__ == "__main__":
    main()
