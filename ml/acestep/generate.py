"""Renders acestep/source.py requests with ACE-Step 1.5's cover mode, the model loaded once.
Runs in the tunebook-acestep image (acestep/Dockerfile); writes {name}.flac and one index line
per clip, and skips clips already in the index.

    docker run --rm --gpus all --memory 10g --cpus 10 -v ~/tunebook-ml:/workspace/ml \
      -v ~/tunebook-ml/cache/acestep/checkpoints:/checkpoints tunebook-acestep \
      python /workspace/ml/acestep/generate.py /workspace/ml/cache/acestep/pilot
"""

import argparse
import json
import shutil
import tempfile
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path, help="holds requests.jsonl and sources/; clips go in out/")
    parser.add_argument("--model", default="acestep-v15-turbo")
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--limit", type=int, help="render only this many (a smoke test)")
    parser.add_argument("--out", default="out", help="output folder inside FOLDER")
    args = parser.parse_args()

    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    out = args.folder / args.out
    out.mkdir(exist_ok=True)
    index = out / "index.jsonl"
    done = {json.loads(line)["name"] for line in index.open()} if index.exists() else set()
    requests = [json.loads(line) for line in (args.folder / "requests.jsonl").open()]
    requests = [r for r in requests if r["name"] not in done][: args.limit]
    print(f"{len(requests)} to render", flush=True)

    dit = AceStepHandler()
    status, ok = dit.initialize_service(project_root="/opt/acestep", config_path=args.model, device=args.device)
    if not ok:
        raise SystemExit(status)
    with index.open("a") as log:
        for request in requests:
            start = time.time()
            params = GenerationParams(
                task_type="cover", src_audio=str(args.folder / request["source"]), caption=request["caption"],
                lyrics="[Instrumental]", instrumental=True, bpm=request["bpm"], keyscale=request["keyscale"],
                timesignature=request["timesignature"], duration=request["duration"], audio_cover_strength=request["strength"],
                inference_steps=args.steps, shift=3.0, seed=request["seed"], thinking=False)
            config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[request["seed"]], audio_format="flac")
            with tempfile.TemporaryDirectory() as scratch:
                result = generate_music(dit, None, params, config, save_dir=scratch)
                entry = {"name": request["name"], "elapsed": round(time.time() - start, 1)}
                if result.success and result.audios:
                    shutil.move(result.audios[0]["path"], out / f"{request['name']}.flac")
                    entry["status"] = "ok"
                else:
                    entry.update(status="failed", error=str(result.error)[:300])
            log.write(json.dumps(entry) + "\n")
            log.flush()
            print(request["name"], entry["status"], entry["elapsed"], flush=True)


if __name__ == "__main__":
    main()
