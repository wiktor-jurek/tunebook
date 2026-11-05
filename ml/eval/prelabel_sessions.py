"""What each recogniser hears along every session recording (or YouTube clip source, --set youtube, or album
section, --set albums), for the labeller.

Writes {audio}.prelabel.{engine}.json beside each whole recording in cache/youtube/full/ (or each clip's source
in cache/youtube/source/), uploads it beside the audio in the bucket and records it on the source
(meta.prelabel_keys), where the labeller (/admin/label) draws it ({model, window, hop, windows: [{t, tune, name, cos}]},
t in seconds into the video). The videos come from eval/sessions.csv and eval/youtube.csv, which store_export.py
writes from the data home.

- tunebook: the Tune finder's model (apps/web/public/finder/model.onnx), an 8 s window every 2 s.
- jigripper: JigRipper's public model replayed offline by jr-session.cjs, kept outside this repo like
  jr-eval.cjs (benchmark.py). Its files are for benchmarking and labelling only and never ship.
- folkfriend: FolkFriend's command-line build (benchmark.py), on 12 s windows every 4 s: it transcribes,
  so it needs longer stretches. It gives a ranking, not a score, so its windows have no cosine.

Where the engines name the same tune, the label is probably right; the labeller shows each engine's
lane and how much of each tune they agree on. Existing files are kept, so a rerun only fills gaps.
--report counts, for each tune the description names, how many engines hear it somewhere in its set.
--resolve fixes names matched to the wrong namesake ("The Castle" has several tunes): an unreviewed row
whose tune no engine hears takes the tune two or more engines hear in its set under the same name (in the data home).

    uv run --with onnxruntime python eval/prelabel_sessions.py --engines tunebook
    uv run --with onnxruntime python eval/prelabel_sessions.py --set albums --engines tunebook --no-publish
    uv run --with onnxruntime python eval/prelabel_sessions.py --jigripper-harness $JR/jr-session.cjs --jigripper-dir $JR/jr \\
        --folkfriend $FF/target/release/folkfriend --folkfriend-home $FF/home
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "train"))
import classifier as c  # noqa: E402
from fetch_youtube import full_path, source_path  # noqa: E402
from tune_names import Tunes  # noqa: E402
from tunebook_ml import pitchclass, store  # noqa: E402

REPO = c.ML.parent
ENGINES = ("tunebook", "jigripper", "folkfriend")
CHUNK = 300  # seconds of audio featurised at once


def output(audio: Path, engine: str) -> Path:
    return audio.with_suffix(f".prelabel.{engine}.json")


def done(audio: Path, engine: str) -> bool:
    # YouTube sources may have JigRipper's timeline from before engines were named: {id}.prelabel.json.
    return output(audio, engine).exists() or (engine == "jigripper" and audio.with_suffix(".prelabel.json").exists())


def duration(path: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                            capture_output=True, text=True, check=True)
    return float(result.stdout)


def tunebook(path: Path, model: Path, names: Tunes) -> dict:
    import onnxruntime as ort
    session = ort.InferenceSession(str(model))
    tunes = json.loads((model.parent / "tunes.json").read_text())
    hop, windows, length = 2, [], duration(path)
    for start in range(0, int(length), CHUNK):
        audio = c.read_audio(path, start=start, duration=CHUNK + 8)
        if len(audio) < 8 * pitchclass.SAMPLE_RATE:
            break
        features = c.windows(audio, hop_seconds=hop)[: CHUNK // hop]
        cos = session.run(None, {"windows": pitchclass.keycanon(features.float()).numpy()})[0]
        for k, row in enumerate(cos):
            best = int(np.argmax(row))
            tune = tunes[best]
            windows.append({"t": start + k * hop, "tune": tune, "name": names.info.get(tune, {}).get("title", "?"), "cos": round(float(row[best]), 3)})
    return {"model": model.name, "window": 8, "hop": hop, "windows": windows}


def folkfriend(path: Path, binary: Path, home: Path, names: Tunes) -> dict:
    span, hop = 12, 4
    starts = list(range(0, int(duration(path)) - span + 1, hop))
    with tempfile.TemporaryDirectory(dir=c.ML / "scratch") as tmp:  # inside a folder Docker shares
        tmp = Path(tmp)
        audio = c.read_audio(path)
        for i, start in enumerate(starts):
            piece = audio[start * pitchclass.SAMPLE_RATE:(start + span) * pitchclass.SAMPLE_RATE]
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(pitchclass.SAMPLE_RATE), "-ac", "1", "-i", "-",
                            "-ar", "48000", "-sample_fmt", "s16", str(tmp / f"{i}.wav")], input=piece.tobytes(), check=True)
        (tmp / "clips.csv").write_text("".join(f"{i}.wav\n" for i in range(len(starts))))
        result = subprocess.run(["docker", "run", "--rm", "-v", f"{tmp}:{tmp}", "-v", f"{home / '.folkfriend'}:/root/.folkfriend",
                                 "-v", f"{binary.resolve()}:/usr/local/bin/folkfriend:ro", "rust:1.82-bookworm",
                                 "folkfriend", "query", str(tmp / "clips.csv")], capture_output=True, text=True, check=True)
    top = {}
    for line in result.stdout.splitlines():
        name, *ids = line.split(",")
        if ids and ids[0]:
            top[int(name.removesuffix(".wav"))] = int(ids[0])
    windows = [{"t": start, "tune": top[i], "name": names.info.get(top[i], {}).get("title", "?"), "cos": None}
               for i, start in enumerate(starts) if i in top]
    return {"model": "FolkFriend", "window": span, "hop": hop, "windows": windows}


MIN_WINDOWS = 3  # confident windows an engine needs to have "heard" a tune in a set


def timelines() -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = {}
    for path in full_path("x").parent.glob("*.prelabel.*.json"):
        youtube_id, _, engine, _ = path.name.rsplit(".", 3)
        out.setdefault(youtube_id, {})[engine] = json.loads(path.read_text())
    return out


def heard_in_set(engines: dict[str, dict], row: dict) -> dict[int, int]:
    """Each tune and how many engines heard it in the row's set."""
    start, end = float(row["set_start_s"]), float(row["set_end_s"])
    out: dict[int, int] = {}
    for data in engines.values():
        counts: dict[int, int] = {}
        for w in data["windows"]:
            if start <= w["t"] < end and (w["cos"] is None or w["cos"] >= 0.26):
                counts[w["tune"]] = counts.get(w["tune"], 0) + 1
        for tune, n in counts.items():
            out[tune] = out.get(tune, 0) + (n >= MIN_WINDOWS)
    return out


def resolve(rows: list[dict], names: Tunes) -> None:
    from tune_names import key, variants
    found = timelines()
    fixed = 0
    for row in rows:
        if row["verified"] or not row["name"] or row["youtube_id"] not in found:
            continue
        heard = heard_in_set(found[row["youtube_id"]], row)
        if row["tune_id"].isdigit() and heard.get(int(row["tune_id"]), 0):
            continue
        namesakes = set().union(*(names.names.get(key(n), set()) for n in variants(row["name"])))
        choice = max((t for t in namesakes if heard.get(t, 0) >= 2), key=lambda t: heard[t], default=None)
        if choice:
            print(f"{row['set_id']} {row['name']}: {row['title'] or '?'} → {names.info[choice]['title']} (heard by {heard[choice]})")
            store.db().execute(
                "update ml.segments g set tune_id = %s, meta = coalesce(g.meta, '{}'::jsonb) || '{\"match\": \"engines\"}', updated_at = now() "
                "from ml.sources s where s.id = g.source_id and s.kind = 'youtube_full' and s.external_id = %s and g.set_id = %s "
                "and g.position = %s and g.verified is null", (choice, row["youtube_id"], row["set_id"], int(row["position"])))
            fixed += 1
    print(f"{fixed} names resolved by the engines")


def publish(videos: list[Path], kind: str) -> None:
    """Puts each recording's prelabel files in the bucket beside its audio, and records their keys on the source."""
    folder = {"youtube_full": "ml/audio/youtube/full/", "album": "ml/audio/album/", "album-track": "ml/audio/album-track/"}.get(kind, "ml/audio/youtube/source/")
    kind = "album" if kind == "album-track" else kind  # a whole track is an album source named by its video
    for video in videos:
        keys = {engine: store.put_audio(output(video, engine), folder + output(video, engine).name) for engine in ENGINES if done(video, engine)}
        if keys:
            store.db().execute("update ml.sources set meta = coalesce(meta, '{}'::jsonb) || %s, updated_at = now() where kind = %s and external_id = %s",
                               (Jsonb({"prelabel_keys": keys}), kind, video.stem))


def report(rows: list[dict]) -> None:
    """How many engines name each described tune in at least MIN_WINDOWS confident windows of its set."""
    found = timelines()
    tally, engines_seen = {}, set()
    for row in rows:
        if not row["tune_id"].isdigit() or row["notes"] == "song" or row["youtube_id"] not in found:
            continue
        engines_seen.update(found[row["youtube_id"]])
        heard = heard_in_set(found[row["youtube_id"]], row).get(int(row["tune_id"]), 0)
        tally[heard] = tally.get(heard, 0) + 1
    total = sum(tally.values())
    print(f"{total} described tunes, engines: {', '.join(sorted(engines_seen))}")
    for n in sorted(tally, reverse=True):
        print(f"  heard by {n}: {tally[n]} ({tally[n] / total:.0%})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=("sessions", "youtube", "albums", "tracks"), default="sessions",
                        help="whole sessions, YouTube clips' sources, album sections (data/found/manifest.jsonl), "
                             "or whole album tracks (data/found/tracks/, store_tracks.py)")
    parser.add_argument("--no-publish", action="store_true", help="write the files beside the audio but leave the bucket and data home alone")
    parser.add_argument("--engines", default=",".join(ENGINES), help="comma-separated: " + ", ".join(ENGINES))
    parser.add_argument("--model", type=Path, default=REPO / "apps" / "web" / "public" / "finder" / "model.onnx")
    parser.add_argument("--jigripper-harness", type=Path, help="jr-session.cjs, kept outside the repo")
    parser.add_argument("--jigripper-dir", type=Path, help="JigRipper's downloaded web files")
    parser.add_argument("--jigripper-modules", type=Path, help="node_modules with onnxruntime-node (default: beside the harness)")
    parser.add_argument("--folkfriend", type=Path, help="the folkfriend binary")
    parser.add_argument("--folkfriend-home", type=Path, help="HOME holding .folkfriend/folkfriend-non-user-data.json")
    parser.add_argument("--report", action="store_true", help="only summarise agreement with the descriptions")
    parser.add_argument("--resolve", action="store_true", help="fix namesake matches the engines contradict, then stop")
    args = parser.parse_args()
    engines = args.engines.split(",")
    with (c.ML / "eval" / "sessions.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    if args.report:
        return report(rows)
    if args.resolve:
        return resolve(rows, Tunes())
    if args.set == "youtube":
        with (c.ML / "eval" / "youtube.csv").open() as handle:
            rows = list(csv.DictReader(handle))
    if args.set == "albums":
        # Each album section is its own source, named by its audio file (store_import.py found()).
        manifest = c.ML / "data" / "found" / "manifest.jsonl"
        videos = [c.ML / "data" / "found" / a for a in dict.fromkeys(json.loads(line)["audio"] for line in manifest.open())]
    elif args.set == "tracks":
        videos = sorted((c.ML / "data" / "found" / "tracks").glob("*.ogg"))
    else:
        where = full_path if args.set == "sessions" else lambda youtube_id: source_path({"youtube_id": youtube_id})
        videos = [where(v) for v in dict.fromkeys(row["youtube_id"] for row in rows)]
    videos = [v for v in videos if v.exists()]
    names = Tunes()
    if "jigripper" in engines:
        if not (args.jigripper_harness and args.jigripper_dir):
            raise SystemExit("jigripper needs --jigripper-harness and --jigripper-dir")
        todo = [{"path": str(v), "out": str(output(v, "jigripper"))} for v in videos if not done(v, "jigripper")]
        if todo:
            with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as manifest:
                manifest.write("".join(json.dumps(row) + "\n" for row in todo))
            modules = args.jigripper_modules or args.jigripper_harness.parent / "node_modules"
            subprocess.run(["node", str(args.jigripper_harness), str(args.jigripper_dir), manifest.name], check=True,
                           env={**os.environ, "NODE_PATH": str(modules)})
            os.unlink(manifest.name)
    for video in videos:
        for engine in engines:
            target = output(video, engine)
            if engine == "jigripper" or done(video, engine):
                continue
            if engine == "tunebook":
                result = tunebook(video, args.model, names)
            elif engine == "folkfriend":
                if not (args.folkfriend and args.folkfriend_home):
                    raise SystemExit("folkfriend needs --folkfriend and --folkfriend-home")
                result = folkfriend(video, args.folkfriend, args.folkfriend_home, names)
            else:
                raise SystemExit(f"unknown engine {engine}")
            target.write_text(json.dumps(result))
            print(f"{video.stem} {engine}: {len(result['windows'])} windows", flush=True)
    if not args.no_publish:
        publish(videos, {"sessions": "youtube_full", "youtube": "youtube_video", "albums": "album", "tracks": "album-track"}[args.set])


if __name__ == "__main__":
    main()
