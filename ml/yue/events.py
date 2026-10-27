"""Writes YuE2 instrumental requests (events.json + style.txt) for catalog settings.

YuE2 takes a melody as note events in quarter notes. We give it the played-out melody of a
setting (repeats expanded, via the catalog export), barred from the setting's ABC so the
pickup lands where it should, and let it arrange its own accompaniment around it.

    uv run python yue/events.py --benchmark 50 --out cache/yue/requests
"""

import argparse
import csv
import io
import json
import math
import re
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML), str(ML / "eval")]

from fetch_youtube import clip_path  # noqa: E402

from found.names import display, download  # noqa: E402
from tunebook_ml.render import load_catalog  # noqa: E402

GRID = Fraction(1, 8)       # L:1/32, the finest grid YuE2 writes
MAX_QUARTERS = 128          # of the tune as written: about 35-45 s at session tempi; training windows need no more
MAX_BPM = 180
TEMPO = {"reel": 220, "hornpipe": 180, "jig": 345, "slip jig": 360, "slide": 380, "polka": 250, "barndance": 200,
         "strathspey": 160, "march": 220, "waltz": 160, "mazurka": 160, "three-two": 200}  # quarter notes, or eighths for x/8
INSTRUMENTS = ["fiddle", "wooden flute", "tin whistle", "button accordion", "uilleann pipes", "concertina", "tenor banjo"]
BACKING = ["acoustic guitar", "Irish bouzouki", "piano vamping", "guitar and bodhrán", "no accompaniment, solo"]
# Training mirrors what Listen will mostly hear: sessions and bands, with duos and soloists less often.
SESSIONS = ["fiddles, flutes and button accordions playing together in a pub session",
            "a pub session of fiddles, flutes, whistles, banjo and concertina all playing the tune",
            "fiddle, flute and accordion in unison", "fiddle, banjo and accordion in unison",
            "two fiddles, flute and uilleann pipes in unison", "a céilí band of fiddles, accordions, flutes and banjo",
            "a trad band with fiddle, flute, uilleann pipes and accordion", "fiddle, concertina and whistle in unison"]
# Named plainly: "DADGAD", "low whistle" and drums pulled YuE2 towards pop and electro-folk.
SESSION_BACKING = ["guitar and bodhrán", "Irish bouzouki and bodhrán", "acoustic guitar and Irish bouzouki", "piano and bodhrán",
                   "guitar, bodhrán and pub chatter", "Irish bouzouki, guitar and bodhrán", "piano vamping and bodhrán"]
DUOS = ["fiddle and flute in unison", "two fiddles in unison", "banjo and fiddle in unison", "flute and uilleann pipes in unison",
        "accordion and fiddle in unison", "concertina and flute in unison"]
SOLOISTS = INSTRUMENTS + ["whistle", "piano accordion", "mandolin", "Irish harp", "hammered dulcimer"]
SOLO_BACKING = BACKING + ["standard-tuned guitar strumming", "guitar and double bass", "piano and bodhrán", "harp"]
LINE_UP_MIX = [(0.6, SESSIONS, SESSION_BACKING), (0.2, DUOS, SOLO_BACKING), (0.2, SOLOISTS, SOLO_BACKING)]
FEELS = ["lively session feel with ornaments", "busy pub session with a crowd", "lively session feel with ornaments", "driving, energetic session feel", "relaxed, unhurried session feel with ornaments",
         "bright dance-hall céilí band feel", "intimate home recording feel", "concert stage recording with a lively audience"]
# YuE2 often swaps the lead (yue/describe.py hears what it played): "fiddle" holds, "whistle" and
# "flute" mostly give a whistle, while "bouzouki" turns electro-folk and piano never sounds.
LINE_UPS = [("fiddle", "acoustic guitar"), ("whistle", "acoustic guitar"), ("flute", "acoustic guitar")]
NOTE = re.compile(r"\{[^}]*\}|\"[^\"]*\"|!\w+!|\[[^\]|]*\]|\(3|[_^=]*[A-Ga-gz][,']*(\d*)(/*)(\d*)|\|")


def pickup(abc: str, meter: str) -> Fraction:
    """Length in quarters of the notes before the first barline, when shorter than a bar."""
    numerator, denominator = (int(x) for x in meter.split("/"))
    bar = Fraction(numerator * 4, denominator)
    total, triplet = Fraction(0), 0
    for match in NOTE.finditer(abc):
        token = match.group(0)
        if token == "|":
            break
        if token == "(3":
            triplet = 3
            continue
        if token[0] in "{\"!" or token.startswith("["):
            continue
        digits, slashes, divisor = match.groups()
        length = Fraction(int(digits) if digits else 1)
        if slashes:
            length /= int(divisor) if divisor else 2 ** len(slashes)
        if triplet:
            length *= Fraction(2, 3)
            triplet -= 1
        total += length / 2  # L:1/8 eighths → quarters
    return total if 0 < total < bar else Fraction(0)


def quantise(value: Fraction) -> Fraction:
    return Fraction(round(value / GRID)) * GRID


def request(setting: dict, abc: str, rng: np.random.Generator, line_up: tuple[str, str] | None = None,
            pace: float = 1.0, feel: str = "lively session feel with ornaments",
            max_quarters: int | None = MAX_QUARTERS, times: int = 1, tempo: tuple[float, Fraction] | None = None) -> tuple[dict, str]:
    meter = setting["meter"] or "4/4"
    numerator, denominator = (int(x) for x in meter.split("/"))
    bar = Fraction(numerator * 4, denominator)
    # Quarters per minute from the tune type's usual pace, with a little spread.
    bpm = TEMPO.get(setting["kind"], 200) * (denominator == 8 and 0.5 or 1) * rng.uniform(0.9, 1.05) * pace
    scale = Fraction(1)
    while bpm > MAX_BPM:  # write fast tunes in halved note values at half the tempo: same speed, saner BPM
        bpm, scale = bpm / 2, scale / 2
    if tempo:  # an existing request's BPM and note scale, when rebuilding its notes
        bpm, scale = tempo
    start = (bar - pickup(abc, meter) * scale) % bar
    # Catalog starts and durations are 1/48 of a whole note. Starts keep rests and pickups;
    # older exports without them fall back to notes played back to back.
    lengths = [Fraction(d, 12) * scale for d in setting["durations"]]
    starts = [Fraction(t, 12) * scale for t in setting["starts"]] if setting.get("starts") else \
        [sum(lengths[:i], Fraction(0)) for i in range(len(lengths))]
    # Each time through starts a whole number of bars later, so a pickup meets the short last bar.
    written_bar = bar * scale
    span = -(-(starts[-1] + lengths[-1]) // written_bar) * written_bar
    onset, notes = start, []
    for time in range(times):
        for pitch, begin_at, length in zip(setting["pitches"], starts, lengths):
            onset = start + time * span + begin_at + length
            begin, end = quantise(onset - length), quantise(onset)
            if end > begin:
                notes.append([str(begin), str(end - begin), int(pitch)])
            if max_quarters and onset >= max_quarters * scale:
                break
        else:
            continue
        break
    # YuE2 takes one melody line, but some exported notes run past the next one (a tie counted
    # twice, a chord): end each note where the next begins, dropping notes that start together.
    notes = [note for note, after in zip(notes, notes[1:] + [None])
             if after is None or Fraction(after[0]) > Fraction(note[0])]
    for note, after in zip(notes, notes[1:]):
        note[1] = str(min(Fraction(note[1]), Fraction(after[0]) - Fraction(note[0])))
    bars = -(-quantise(onset) // bar)
    key_letter = re.match(r"[A-G][b#]?", setting["mode"] or "D").group(0)
    key = key_letter + ("m" if re.search(r"minor|aeolian|dorian|phrygian", setting["mode"] or "", re.I) else "")
    events = {"bpm": int(round(bpm)), "key": key, "bars": [{"meter": meter, "section": "instrumental"}] + [{}] * (int(bars) - 1), "notes": notes}
    instrument, backing = line_up or (rng.choice(INSTRUMENTS), rng.choice(BACKING))
    style = (f"Instrumental, Irish traditional {setting['kind'] or 'tune'}, {instrument} playing the melody with "
             f"{'no accompaniment' if backing.startswith('no') else backing + ' accompaniment'}, {feel}, "
             f"{key_letter} {'minor' if key.endswith('m') else 'major'}, {events['bpm']} BPM, natural room acoustics, "
             "no vocals, no singing, no choir, no spoken words.")
    return events, style


def retime(path: Path, abc: dict[int, str]) -> None:
    """Rebuilds the notes of existing requests from the current catalog export, keeping each
    request's name, setting, seed, prompt and tempo, so finished clips keep their place."""
    catalog = {row["settingId"]: row for row in load_catalog()}
    rows = [json.loads(line) for line in path.open()]
    changed = 0
    for row in rows:
        setting, old = catalog[row["setting_id"]], row["events"]
        first = Fraction(old["notes"][0][1]) / (Fraction(setting["durations"][0], 12))
        scale = Fraction(1, 2 ** round(math.log2(1 / first))) if first < 1 else Fraction(1)
        events, _ = request(setting, abc[row["setting_id"]], np.random.default_rng(0), ("x", "y"), tempo=(old["bpm"], scale))
        changed += events != old
        row["events"] = events
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    print(f"{changed} of {len(rows)} requests rebuilt with changed notes → {path}")


def melody_settings(abc: dict[int, str]) -> dict[int, list[dict]]:
    """Settings with one clean melody line: multi-voice ones sometimes export their bass part."""
    settings: dict[int, list[dict]] = {}
    for row in load_catalog():
        if row["settingId"] in abc and "V:" not in abc[row["settingId"]] and np.median(row["pitches"]) >= 60 and len(row["pitches"]) >= 48:
            settings.setdefault(row["tuneId"], []).append(row)
    return settings


def write_requests(abc: dict[int, str], settings: dict[int, list[dict]], tunes: list[int], versions: int, out: Path, tag: str = "") -> None:
    """Each tune in several random settings, line-ups (mostly sessions), paces and feels."""
    out.parent.mkdir(parents=True, exist_ok=True)
    salt = 11 if not tag else 11 + sum(map(ord, tag))
    with out.open("w") as handle:
        for tune_id in tunes:
            for version in range(versions):
                rng = np.random.default_rng([tune_id, version, salt])
                setting = settings[tune_id][int(rng.integers(len(settings[tune_id])))]
                _, players, backing = LINE_UP_MIX[int(rng.choice(len(LINE_UP_MIX), p=[share for share, _, _ in LINE_UP_MIX]))]
                line_up = (str(rng.choice(players)), str(rng.choice(backing)))
                events, style = request(setting, abc[setting["settingId"]], rng, line_up, float(rng.uniform(0.75, 1.1)), str(rng.choice(FEELS)))
                handle.write(json.dumps({"name": f"{tune_id}-s{setting['settingId']}-{tag}{version}", "tune_id": tune_id,
                                         "setting_id": setting["settingId"], "seed": int(rng.integers(2**31)),
                                         "events": events, "style": style}) + "\n")
    print(f"{len(tunes) * versions} requests for {len(tunes)} tunes → {out}")


def benchmark_tunes() -> set[int]:
    with (ML / "eval" / "youtube.csv").open() as handle:
        return {int(row["tune_id"]) for row in csv.DictReader(handle) if row["tune_id"].isdigit()}


def write_training(abc: dict[int, str], count: int, versions: int, out: Path) -> None:
    """The most popular training-split tunes, never benchmark ones."""
    from found.names import popularity
    from tunebook_ml.splits import split_of
    settings, benchmark, rank = melody_settings(abc), benchmark_tunes(), popularity()
    tunes = sorted((t for t in settings if split_of(t) == "train" and t not in benchmark), key=lambda t: -rank.get(t, 0))[:count]
    write_requests(abc, settings, tunes, versions, out)


def write_references(abc: dict[int, str], count: int, versions: int, out: Path) -> None:
    """Evaluation references: every tune either real test set labels, plus popular distractors from
    the valid and test splits (never trained on), up to `count` tunes. Listen will rank YuE2 audio
    like this, so this is the setup to score."""
    from found.names import popularity
    from tunebook_ml.splits import split_of
    settings, rank = melody_settings(abc), popularity()
    labelled = benchmark_tunes()
    found = ML / "data" / "found" / "manifest.jsonl"
    if found.exists():
        labelled |= {row["tune_id"] for row in map(json.loads, found.open()) if row["split"] in ("valid", "test")}
    labelled &= set(settings)
    distractors = sorted((t for t in settings if split_of(t) != "train" and t not in labelled), key=lambda t: -rank.get(t, 0))
    tunes = sorted(labelled) + distractors[: max(0, count - len(labelled))]
    write_requests(abc, settings, tunes, versions, out, tag="r")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark", type=int, default=50, help="benchmark tunes with fetched clips to cover")
    parser.add_argument("--versions", type=int, default=2)
    parser.add_argument("--setting", type=int, help="one setting in three line-ups, for listening, instead of the benchmark")
    parser.add_argument("--pace", type=float, default=1.0, help="with --setting: tempo relative to the tune type's usual pace")
    parser.add_argument("--times", type=int, default=1, help="with --setting: play the tune this many times through, as a session does")
    parser.add_argument("--line-up", action="append", metavar="LEAD=BACKING",
                        help="with --setting: line-ups to render instead of LINE_UPS, e.g. 'fiddle=Irish bouzouki'")
    parser.add_argument("--feel", default="lively session feel with ornaments", help="with --setting: playing style in the prompt")
    parser.add_argument("--references", type=int, help="write a JSONL of evaluation references for this many tunes instead")
    parser.add_argument("--train", type=int, help="write a JSONL of this many training tunes (train split, never benchmark) instead")
    parser.add_argument("--retime", type=Path, help="rebuild the notes of this requests JSONL in place from the current catalog")
    parser.add_argument("--out", default=str(ML / "cache" / "yue" / "requests"))
    args = parser.parse_args()

    abc = {int(row["setting_id"]): row["abc"] for row in csv.DictReader(io.StringIO(download("tunes")))}
    if args.setting:
        setting = next(row for row in load_catalog() if row["settingId"] == args.setting)
        line_ups = [tuple(entry.split("=", 1)) for entry in args.line_up] if args.line_up else LINE_UPS
        for version, line_up in enumerate(line_ups):
            events, style = request(setting, abc[args.setting], np.random.default_rng([args.setting, version]), line_up, args.pace, args.feel,
                                    max_quarters=None, times=args.times)  # a play-along plays the whole tune
            target = Path(args.out) / f"{setting['tuneId']}-s{args.setting}-{version}"
            target.mkdir(parents=True, exist_ok=True)
            (target / "events.json").write_text(json.dumps(events))
            (target / "style.txt").write_text(style)
            print(target.name, events["bpm"], f"{len(events['bars'])} bars", line_up)
        return
    if args.retime:
        retime(args.retime, abc)
        return
    if args.train:
        write_training(abc, args.train, args.versions, Path(args.out))
        return
    if args.references:
        write_references(abc, args.references, args.versions, Path(args.out))
        return
    settings: dict[int, list[dict]] = {}
    for row in load_catalog():
        # One clean melody line: multi-voice settings sometimes export their bass part.
        if row["settingId"] in abc and "V:" not in abc[row["settingId"]] and np.median(row["pitches"]) >= 60 and len(row["pitches"]) >= 48:
            settings.setdefault(row["tuneId"], []).append(row)
    with (ML / "eval" / "youtube.csv").open() as handle:
        rows = [row for row in csv.DictReader(handle) if clip_path(row).exists() and int(row["tune_id"]) in settings]
    rng = np.random.default_rng(5)
    chosen = list(dict.fromkeys(int(row["tune_id"]) for row in rows))
    chosen = [chosen[i] for i in sorted(rng.choice(len(chosen), min(args.benchmark, len(chosen)), replace=False))]

    out = Path(args.out)
    for tune_id in chosen:
        for version in range(args.versions):
            vrng = np.random.default_rng([tune_id, version])
            setting = settings[tune_id][0] if version == 0 else settings[tune_id][int(vrng.integers(len(settings[tune_id])))]
            events, style = request(setting, abc[setting["settingId"]], vrng)
            target = out / f"{tune_id}-{version}"
            target.mkdir(parents=True, exist_ok=True)
            (target / "events.json").write_text(json.dumps(events))
            (target / "style.txt").write_text(style)
            (target / "meta.json").write_text(json.dumps({"tune_id": tune_id, "setting_id": setting["settingId"], "title": display(setting["title"])}))
    print(f"{len(chosen) * args.versions} requests for {len(chosen)} tunes → {out}")


if __name__ == "__main__":
    main()
