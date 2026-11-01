"""Lists every YuE2 training performance for store_import.py --yue: name, box, tune, setting, length and
the request's seed, tempo and key. Runs where the audio is (mantis):

    python yue/inventory.py > scratch/yue-inventory.json
"""

import json
import sys
from pathlib import Path

import soundfile

ML = Path(__file__).resolve().parents[1]


def main() -> None:
    requests = {}
    for path in sorted((ML / "cache" / "yue").glob("train*.jsonl")):
        for line in path.open():
            request = json.loads(line)
            requests[request["name"]] = request
    items = []
    for path in sorted((ML / "data" / "yue" / "train").glob("*/*.ogg")):
        request = requests.get(path.stem, {})
        tune, setting = path.stem.split("-")[:2]  # <tune>-s<setting>-<n>
        try:
            seconds = soundfile.info(str(path)).duration
        except RuntimeError:
            continue
        events = request.get("events", {})
        items.append({"name": path.stem, "box": path.parent.name, "tune_id": int(tune), "setting_id": int(setting.removeprefix("s")),
                      "seconds": round(seconds, 2), "seed": request.get("seed"), "bpm": events.get("bpm"), "key": events.get("key")})
    json.dump(items, sys.stdout)
    print(f"{len(items)} performances, {sum(1 for i in items if i['seed'] is None)} without a request", file=sys.stderr)


if __name__ == "__main__":
    main()
