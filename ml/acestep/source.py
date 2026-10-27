"""Pilot requests for ACE-Step 1.5 covers: a dry FluidSynth render of each setting, played as
written (rests kept) at its tune type's usual tempo, which ACE-Step's cover mode restyles
under a session prompt. Settings come from the YuE2 training clips, so the two generators
can be compared on the same tunes.

    uv run python acestep/source.py --tunes 20
    rsync -az cache/acestep/pilot mantis:tunebook-ml/cache/acestep/
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML), str(ML / "yue")]

import tunebook_ml.render as render  # noqa: E402
from tunebook_ml.performance import Instrument, Note, Part  # noqa: E402

render.SAMPLE_RATE = 44100  # ACE-Step works at 48 kHz: a 16 kHz source would sound muffled through it
from events import TEMPO  # noqa: E402

SOUNDFONT = ML / "cache" / "soundfonts" / "GeneralUser-GS.sf2"
# The leads YuE2 wouldn't play, each with a General MIDI stand-in for the source.
LEADS = {"wooden flute": 73, "uilleann pipes": 109, "button accordion": 21, "concertina": 23, "tenor banjo": 105,
         "tin whistle": 78, "fiddle": 40, "mandolin": 25}
BACKINGS = ["acoustic guitar", "acoustic guitar and bodhrán", "piano", "Irish bouzouki", "no"]
STRENGTHS = [0.4, 0.7, 1.0]
MIN_SECONDS, MAX_TIMES = 40, 3


def whole_seconds(setting: dict) -> float:
    """Length of a whole note: TEMPO counts quarters, or eighths in x/8 time."""
    denominator = int((setting["meter"] or "4/4").split("/")[1])
    return (8 if denominator == 8 else 4) * 60 / TEMPO.get((setting["kind"] or "").lower(), 200)


def notes(setting: dict) -> tuple[list[Note], float]:
    """The tune as written, as many times through as fills MIN_SECONDS, with the bar it ends in."""
    numerator, denominator = (int(x) for x in (setting["meter"] or "4/4").split("/"))
    bar = 48 * numerator // denominator
    end = max(s + d for s, d in zip(setting["starts"], setting["durations"]))
    span = -(-end // bar) * bar
    unit = whole_seconds(setting) / 48
    times = int(np.clip(np.ceil(MIN_SECONDS / (span * unit)), 1, MAX_TIMES))
    played = [Note(onset=(time * span + start) * unit, duration=length * unit * 0.95, midi=pitch, velocity=90)
              for time in range(times) for start, length, pitch in zip(setting["starts"], setting["durations"], setting["pitches"])]
    return played, times * span * unit


def bpm(setting: dict) -> int:
    numerator, denominator = (int(x) for x in (setting["meter"] or "4/4").split("/"))
    tempo = TEMPO.get((setting["kind"] or "").lower(), 200)
    return round(tempo / 3 if denominator == 8 else tempo if numerator == 3 else tempo / 2)


def keyscale(mode: str | None) -> str:
    mode = mode or "Dmajor"
    tonic = mode[:2] if len(mode) > 1 and mode[1] in "#b" else mode[0]
    return f"{tonic} {'minor' if any(m in mode for m in ('minor', 'dorian', 'aeolian', 'phrygian')) else 'major'}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tunes", type=int, default=20)
    parser.add_argument("--line-ups", type=int, default=2, help="line-ups per tune, each at every cover strength")
    parser.add_argument("--out", type=Path, default=ML / "cache" / "acestep" / "pilot")
    args = parser.parse_args()
    catalog = {row["settingId"]: row for row in render.load_catalog()}
    clips = [json.loads(line) for line in (ML / "cache" / "yue" / "playalong" / "training.jsonl").open()]
    rng = np.random.default_rng(0)
    chosen, kinds = [], {}
    for clip in rng.permutation(len(clips)):
        setting = catalog.get(clips[clip]["settingId"])
        # A mix of tune types, a few of each.
        if setting and setting.get("starts") and kinds.get(setting["kind"], 0) < max(2, args.tunes // 5):
            chosen.append(setting)
            kinds[setting["kind"]] = kinds.get(setting["kind"], 0) + 1
        if len(chosen) == args.tunes:
            break
    (args.out / "sources").mkdir(parents=True, exist_ok=True)
    requests = []
    for setting in chosen:
        played, seconds = notes(setting)
        for lead in rng.choice(list(LEADS), args.line_ups, replace=False):
            backing = str(rng.choice(BACKINGS))
            name = f"{setting['tuneId']}-s{setting['settingId']}-{lead.replace(' ', '_')}"
            source = args.out / "sources" / f"{name}.wav"
            audio = render.synthesise(Part(Instrument(lead, LEADS[lead], 0, 127, 0), played), SOUNDFONT, seconds + 1)
            soundfile.write(source, audio / (np.abs(audio).max() + 1e-9) * 0.8, render.SAMPLE_RATE)
            caption = (f"Irish traditional {setting['kind'] or 'tune'}, instrumental, {lead} playing the melody with "
                       f"{'no accompaniment' if backing == 'no' else backing + ' accompaniment'}, lively session recording, "
                       "natural room acoustics, acoustic instruments only")
            for strength in STRENGTHS:
                requests.append({"name": f"{name}-c{int(strength * 10)}", "tune_id": setting["tuneId"], "setting_id": setting["settingId"],
                                 "source": f"sources/{source.name}", "caption": caption, "strength": strength,
                                 "bpm": bpm(setting), "keyscale": keyscale(setting["mode"]),
                                 "timesignature": (setting["meter"] or "4/4").split("/")[0], "duration": round(seconds + 1, 1),
                                 "seed": int(rng.integers(2 ** 31))})
        print(f"{setting['title']} ({setting['kind']}, {setting['meter']}): {seconds:.0f}s")
    (args.out / "requests.jsonl").write_text("".join(json.dumps(r) + "\n" for r in requests))
    print(f"{len(requests)} requests from {len(chosen)} settings → {args.out}")


if __name__ == "__main__":
    main()
