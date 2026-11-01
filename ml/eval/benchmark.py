"""Tune recognisers on the same real clips, for the Tune finder's benchmark page.

- Tunebook: the shipped browser model (public/finder/model.onnx) on each clip's features (classifier.py prepare).
- FolkFriend (https://github.com/TomWyllie/folkfriend, GPL-3.0): its command-line build on the same audio,
  upsampled to the 48 kHz its frames are sized for.
- JigRipper (jigripper.com): its public web model and front end, replayed offline by a harness kept outside
  this repo. Its files are for benchmarking only and never ship or get committed.

Every engine hears the whole clip, then (with --timing) only its first 2, 4, ... 30 seconds:
the answer at each length shows how soon it locks on. Engines not asked for this run keep their
answers from the existing output, so a new Tunebook model only reruns Tunebook. Writes src/lib/finder/benchmark.json:
answers and links, no audio.

FolkFriend is a Linux build, so it runs in its build image (which also has the OpenSSL it links):

    docker run --rm -v $FF/src/rust:/src -v $FF/target:/src/target -w /src rust:1.82-bookworm cargo build --release --bin folkfriend
    python eval/benchmark.py --tunebook --folkfriend $FF/target/release/folkfriend --folkfriend-home $FF/home \\
        --jigripper-harness $JR/tools/jr-eval.cjs --jigripper-dir $JR/jr
"""

import argparse
import csv
import gzip
import json
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "train"))
import classifier as c  # noqa: E402
from tunebook_ml import pitchclass  # noqa: E402

REPO = c.ML.parent
ENGINES = ("tunebook", "folkfriend", "jigripper")
PREFIXES = [2, 4, 6, 8, 10, 12, 15, 20, 25, 30]  # seconds heard, for --timing
# Popularity bands by catalogue rank (most tunebooks first): 1 = top 100 ... 5 = beyond 8,000 or in no tunebook.
BAND_RANKS = [100, 500, 2000, 8000]


def clips(path: Path, reference: Path) -> list[dict]:
    """Every real clip with its set, tune, instrument and where to hear it."""
    found = {row["audio"]: row for row in map(json.loads, (c.ML / "data" / "found" / "manifest.jsonl").open())}
    with (c.ML / "eval" / "youtube.csv").open() as handle:
        instruments = {f"{r['youtube_id']}.{r['start_s']}-{r['duration_s']}": r for r in csv.DictReader(handle)}
    sessions = c.ML / "eval" / "sessions.csv"
    if sessions.exists():
        with sessions.open() as handle:
            instruments.update({f"{r['youtube_id']}.{r['start_s']}-{r['duration_s']}": r for r in csv.DictReader(handle)})
    chosen = {row["path"] for row in torch.load(reference)["youtube"]}
    data = torch.load(path)
    out = []
    for name in ("youtube", "sessions", "bands", "albums"):
        for row in data.get(name, []):
            audio = c.ML / Path(row["path"]).relative_to("/workspace/ml") if row["path"].startswith("/workspace/") else Path(row["path"])
            if name in ("youtube", "sessions"):
                meta = instruments[audio.stem]
                video, start = meta["youtube_id"], float(meta["start_s"])
                group = name if name == "sessions" else "youtube" if row["path"] in chosen else "holdout"
                instrument = meta.get("instrument") or meta.get("instruments") or "unknown"
            else:
                meta = found[f"audio/{audio.name}"]
                video, start, group, instrument = meta["video_id"], meta["start_s"], name, "band"
            out.append({"set": group, "tuneId": row["tune_id"], "instrument": instrument, "video": video, "start": round(start),
                        "path": audio, "windows": row["windows"], "results": {}})
    return out


def popularity_bands(rows: list[dict]) -> None:
    counts = c.popularity()
    rank = {tune: i + 1 for i, tune in enumerate(sorted(counts, key=lambda t: -counts[t]))}
    for row in rows:
        row["tunebooks"] = counts.get(row["tuneId"], 0)
        row["popularity"] = 1 + sum(rank.get(row["tuneId"], len(rank) + 1) > edge for edge in BAND_RANKS)


def answer(top: int | None, rank: int | None) -> dict:
    return {"top": top, "rank": rank}


# The finder adds POPULARITY_WEIGHT * ln(tunebooks + 1) to each tune's mean cosine (src/lib/finder/decode.ts).
POPULARITY_WEIGHT = 0.006


def prior(model: Path, tunes: list[int]) -> np.ndarray:
    """The finder's popularity prior per column, from popularity.json beside the model (zeros without one)."""
    path = model.parent / "popularity.json"
    if not path.exists():
        print(f"no {path}: Tunebook scored without the popularity prior", flush=True)
        return np.zeros(len(tunes), dtype=np.float32)
    counts = json.loads(path.read_text())
    assert len(counts) == len(tunes), "popularity.json does not match tunes.json"
    return POPULARITY_WEIGHT * np.log(np.array(counts, dtype=np.float32) + 1)


def tunebook(rows: list[dict], model: Path) -> dict:
    import onnxruntime as ort
    session = ort.InferenceSession(str(model))
    tunes = json.loads((model.parent / "tunes.json").read_text())
    boost = prior(model, tunes)
    for row in rows:
        mean = session.run(None, {"windows": pitchclass.keycanon(row["windows"].float()).numpy()})[0].mean(0) + boost
        row["results"]["tunebook"] = answer(tunes[int(mean.argmax())], int((mean > mean[tunes.index(row["tuneId"])]).sum()) + 1)
    return {"name": "Tunebook", "detail": f"{model.name}, the Tune finder's own model", "tunes": len(tunes), "missing": []}


def curve(answers: list[bool | None]) -> str:
    """Right ("1"), wrong ("0") or no answer yet ("-") after each of PREFIXES seconds."""
    return "".join("-" if a is None else "1" if a else "0" for a in answers)


def tunebook_timing(rows: list[dict], model: Path) -> None:
    """The live finder's leader after each second, replayed exactly: from 3 s on it scores the last 8 s
    once a second (zero-padded until 8 s have been heard), averages the last HISTORY windows and adds
    the popularity prior (decode.ts)."""
    import onnxruntime as ort
    history = 30
    session = ort.InferenceSession(str(model))
    tunes = json.loads((model.parent / "tunes.json").read_text())
    boost = prior(model, tunes)
    for row in rows:
        audio = c.read_audio(row["path"], duration=PREFIXES[-1])
        seconds = len(audio) // pitchclass.SAMPLE_RATE
        partial = torch.cat([c.windows(audio[: s * pitchclass.SAMPLE_RATE]) for s in range(1, min(8, seconds + 1))])
        full = row["windows"][: max(0, seconds - 7)]  # the window ending at second s is full[s - 8]
        x = pitchclass.keycanon(torch.cat([partial.float(), full.float()]))
        cos = session.run(None, {"windows": x.numpy()})[0]  # row s - 1 ends at second s
        truth = tunes.index(row["tuneId"])
        answers = []
        for t in PREFIXES:
            end = min(t, seconds)
            # The finder scores nothing before 3 s have been heard (use-listener.ts), so rows 0 and 1 never count.
            heard = cos[max(2, end - history):end]
            answers.append(bool((heard.mean(0) + boost).argmax() == truth) if len(heard) else None)
        row["results"]["tunebook"]["curve"] = curve(answers)


def folkfriend(rows: list[dict], binary: Path, home: Path, version: str) -> dict:
    with tempfile.TemporaryDirectory(dir=c.ML / "scratch") as tmp:  # inside a folder Docker shares
        tmp = Path(tmp)
        for i, row in enumerate(rows):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(row["path"]), "-ac", "1", "-ar", "48000", "-sample_fmt", "s16",
                            str(tmp / f"{i}.wav")], check=True)
        (tmp / "clips.csv").write_text("".join(f"{i}.wav\n" for i in range(len(rows))))
        result = subprocess.run(["docker", "run", "--rm", "-v", f"{tmp}:{tmp}", "-v", f"{home / '.folkfriend'}:/root/.folkfriend",
                                 "-v", f"{binary.resolve()}:/usr/local/bin/folkfriend:ro", "rust:1.82-bookworm",
                                 "folkfriend", "query", str(tmp / "clips.csv")], capture_output=True, text=True, check=True)
    answers = {}
    for line in result.stdout.splitlines():
        name, *ids = line.split(",")
        answers[int(name.removesuffix(".wav"))] = list(dict.fromkeys(int(t) for t in ids))  # one entry per tune, in FolkFriend's order
    for i, row in enumerate(rows):
        ranked = answers.get(i, [])
        row["results"]["folkfriend"] = answer(ranked[0] if ranked else None, ranked.index(row["tuneId"]) + 1 if row["tuneId"] in ranked else None)
    index = json.loads((home / ".folkfriend" / "folkfriend-non-user-data.json").read_text())
    indexed = {int(s["tune_id"]) for s in index["settings"].values()}
    return {"name": "FolkFriend", "detail": f"command-line build{f' (commit {version})' if version else ''}", "tunes": len(indexed),
            "missing": sorted({row["tuneId"] for row in rows} - indexed)}


def folkfriend_timing(rows: list[dict], binary: Path, home: Path) -> None:
    """FolkFriend's answer on the first t seconds of each clip, for each t in PREFIXES."""
    with tempfile.TemporaryDirectory(dir=c.ML / "scratch") as tmp:
        tmp = Path(tmp)
        names = []
        for i, row in enumerate(rows):
            for t in PREFIXES:
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(row["path"]), "-t", str(t), "-ac", "1", "-ar", "48000",
                                "-sample_fmt", "s16", str(tmp / f"{i}-{t}.wav")], check=True)
                names.append(f"{i}-{t}.wav")
        (tmp / "clips.csv").write_text("".join(f"{name}\n" for name in names))
        result = subprocess.run(["docker", "run", "--rm", "-v", f"{tmp}:{tmp}", "-v", f"{home / '.folkfriend'}:/root/.folkfriend",
                                 "-v", f"{binary.resolve()}:/usr/local/bin/folkfriend:ro", "rust:1.82-bookworm",
                                 "folkfriend", "query", str(tmp / "clips.csv")], capture_output=True, text=True, check=True)
    tops = {}
    for line in result.stdout.splitlines():
        name, *ids = line.split(",")
        tops[name] = int(ids[0]) if ids and ids[0] else None
    for i, row in enumerate(rows):
        row["results"]["folkfriend"]["curve"] = curve([None if tops.get(f"{i}-{t}.wav") is None else tops[f"{i}-{t}.wav"] == row["tuneId"]
                                                       for t in PREFIXES])


def jigripper_timing(rows: list[dict], harness: Path, folder: Path) -> None:
    """jr-prefix.cjs (beside jr-eval.cjs, outside the repo): JigRipper's answer on the first t seconds. Its windows need 8 s."""
    with tempfile.TemporaryDirectory() as tmp:
        manifest, out = Path(tmp) / "clips.jsonl", Path(tmp) / "out.jsonl"
        manifest.write_text("".join(json.dumps({"id": i, "path": str(row["path"]), "tune_id": row["tuneId"]}) + "\n" for i, row in enumerate(rows)))
        subprocess.run(["node", str(harness.parent / "jr-prefix.cjs"), str(folder), str(manifest), str(out)], check=True, cwd=harness.parent,
                       stderr=subprocess.DEVNULL)
        results = {r["id"]: r for r in map(json.loads, out.read_text().splitlines())}
    for i, row in enumerate(rows):
        row["results"]["jigripper"]["curve"] = curve([None if a is None else bool(a) for a in results[i]["answers"]])


def jigripper(rows: list[dict], harness: Path, folder: Path) -> dict:
    """The harness replays JigRipper's own front end and model on each file and scores its clip-level answer.
    JigRipper merges some duplicate tunes; the harness counts an answer as right when it is the tune the truth was merged into."""
    with tempfile.TemporaryDirectory() as tmp:
        manifest, out = Path(tmp) / "clips.jsonl", Path(tmp) / "out.jsonl"
        manifest.write_text("".join(json.dumps({"id": i, "path": str(row["path"]), "tune_id": row["tuneId"]}) + "\n" for i, row in enumerate(rows)))
        subprocess.run(["node", str(harness), str(folder), str(manifest), str(out)], check=True, cwd=harness.parent, stderr=subprocess.DEVNULL)
        results = {r["id"]: r for r in map(json.loads, out.read_text().splitlines())}
    for i, row in enumerate(rows):
        r = results.get(i)
        row["results"]["jigripper"] = answer(r["top"][0][0], r["rank"] or None) if r else answer(None, None)
    tunes = json.loads((folder / "1006" / "tune_index.json").read_text())
    redirects = json.loads((folder / "1006" / "canonical_redirects.json").read_text())
    known = {int(t) for t in tunes} | {int(t) for t in redirects}
    return {"name": "JigRipper", "detail": "web model #1006", "tunes": len(tunes), "missing": sorted({row["tuneId"] for row in rows} - known)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tunebook", action="store_true", help="run the Tune finder's model")
    parser.add_argument("--model", type=Path, default=REPO / "public" / "finder" / "model.onnx")
    parser.add_argument("--folkfriend", type=Path, help="the folkfriend binary")
    parser.add_argument("--folkfriend-home", type=Path, help="HOME holding .folkfriend/folkfriend-non-user-data.json")
    parser.add_argument("--folkfriend-version", default="", help="commit the binary was built from")
    parser.add_argument("--jigripper-harness", type=Path, help="jr-eval.cjs, kept outside the repo")
    parser.add_argument("--jigripper-dir", type=Path, help="JigRipper's downloaded web files")
    parser.add_argument("--timing", action="store_true", help="also score each engine run on the first 2 … 30 seconds")
    parser.add_argument("--timing-only", action="store_true", help="keep the whole-clip answers from the existing output")
    parser.add_argument("--clips", type=Path, default=c.ML / "cache" / "classifier" / "clips-v2.pt")
    parser.add_argument("--reference", type=Path, default=c.CLIPS, help="YouTube clips missing from this file form the holdout")
    parser.add_argument("--out", type=Path, default=REPO / "src" / "lib" / "finder" / "benchmark.json")
    args = parser.parse_args()

    rows = clips(args.clips, args.reference)
    popularity_bands(rows)
    print(f"{len(rows)} clips")
    old = json.loads(args.out.read_text()) if args.out.exists() else {"engines": {}, "clips": []}
    engines = dict(old.get("engines", {}))
    args.timing |= args.timing_only
    if args.tunebook and not args.timing_only:
        engines["tunebook"] = tunebook(rows, args.model)
    if args.folkfriend and not args.timing_only:
        engines["folkfriend"] = folkfriend(rows, args.folkfriend, args.folkfriend_home, args.folkfriend_version)
    if args.jigripper_harness and not args.timing_only:
        engines["jigripper"] = jigripper(rows, args.jigripper_harness, args.jigripper_dir)
    # Engines not run this time keep their earlier answers (and timing, unless it is rerun).
    earlier = {(clip["video"], clip["start"], clip["tuneId"]): clip.get("results", {}) for clip in old["clips"]}
    for row in rows:
        for engine, result in earlier.get((row["video"], row["start"], row["tuneId"]), {}).items():
            if engine not in row["results"]:
                row["results"][engine] = result
            elif "curve" in result:
                row["results"][engine].setdefault("curve", result["curve"])
    if args.timing:
        if args.tunebook:
            tunebook_timing(rows, args.model)
        if args.folkfriend:
            folkfriend_timing(rows, args.folkfriend, args.folkfriend_home)
        if args.jigripper_harness:
            jigripper_timing(rows, args.jigripper_harness, args.jigripper_dir)
    engines = {key: engines[key] for key in ENGINES if key in engines}
    for key in engines:
        assert all(key in row["results"] for row in rows), f"{key} has no answer for some clips: run it again"

    wanted = {t for row in rows for t in [row["tuneId"], *(r["top"] for r in row["results"].values())] if t is not None}
    titles = {}
    with gzip.open(c.ML / "data" / "catalog.jsonl.gz", "rt") as handle:
        for setting in map(json.loads, handle):
            if setting["tuneId"] in wanted and setting["tuneId"] not in titles:
                titles[setting["tuneId"]] = {"title": setting["title"], "kind": setting["kind"]}
    out = {
        "generated": date.today().isoformat(),
        "prefixes": PREFIXES,
        "bandRanks": BAND_RANKS,
        "engines": engines,
        "tunes": {str(t): v for t, v in sorted(titles.items())},
        "clips": [{k: v for k, v in row.items() if k not in ("path", "windows")} for row in rows],
    }
    args.out.write_text(json.dumps(out, separators=(",", ":")))
    for name in ("youtube", "holdout", "bands", "albums"):
        sub = [r for r in rows if r["set"] == name]
        print(f"{name}: {len(sub)} clips, " + ", ".join(f"{key} {np.mean([r['results'][key]['rank'] == 1 for r in sub]):.3f}" for key in engines))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
