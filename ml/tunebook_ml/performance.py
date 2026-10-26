"""Turns a catalog setting into a human-like performance: tempo, lilt, ornaments,
variations, key and instrument range, then a backing part that follows the same time.

All times are seconds. Durations in settings are 1/48 of a whole note (a quaver is 6).
"""

from dataclasses import dataclass, field

import numpy as np

QUAVER = 6
# Quaver length in seconds at session tempo, by tune type.
QUAVER_SECONDS = {
    "reel": (0.115, 0.16), "hornpipe": (0.13, 0.18), "barndance": (0.14, 0.19), "strathspey": (0.15, 0.21),
    "jig": (0.12, 0.165), "slip jig": (0.13, 0.17), "slide": (0.1, 0.135), "polka": (0.12, 0.165),
    "waltz": (0.17, 0.25), "mazurka": (0.17, 0.24), "march": (0.14, 0.2), "three-two": (0.13, 0.18),
}
# How much longer the first quaver of a pair is than the second.
SWING = {"reel": (1.0, 1.25), "hornpipe": (1.3, 1.9), "barndance": (1.3, 1.8), "strathspey": (1.4, 2.4), "polka": (1.0, 1.2)}
MODES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "dorian": [0, 2, 3, 5, 7, 9, 10], "mixolydian": [0, 2, 4, 5, 7, 9, 10]}
TONICS = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}


@dataclass
class Instrument:
    name: str
    program: int
    low: int
    high: int
    ornaments: float  # how readily the player ornaments
    bends: bool = False  # slides into notes
    drone: bool = False


MELODY_INSTRUMENTS = [
    Instrument("fiddle", 40, 55, 88, 0.8, bends=True),
    Instrument("fiddle", 110, 55, 88, 0.8, bends=True),
    Instrument("flute", 73, 62, 93, 1.0, bends=True),
    Instrument("whistle", 78, 74, 98, 1.0),
    Instrument("low whistle", 75, 57, 81, 1.0, bends=True),
    Instrument("recorder", 74, 72, 96, 0.6),
    Instrument("pipes", 109, 62, 83, 1.2, drone=True),
    Instrument("accordion", 21, 55, 88, 0.5),
    Instrument("concertina", 23, 55, 91, 0.5),
    Instrument("harmonica", 22, 60, 88, 0.3, bends=True),
    Instrument("banjo", 105, 48, 84, 0.4),
    Instrument("mandolin", 25, 55, 88, 0.3),
    Instrument("piano", 0, 55, 91, 0.2),
]


@dataclass
class Note:
    onset: float
    duration: float
    midi: int
    velocity: int
    bend_from: float = 0.0  # semitones to slide in from


@dataclass
class Part:
    instrument: Instrument
    notes: list[Note]
    detune_cents: float = 0.0
    drums: bool = False


@dataclass
class Performance:
    melody: list[Part]
    backing: list[Part]
    #: Onset in seconds of each setting note the lead played, by note index (first time round).
    note_onsets: dict[int, float] = field(default_factory=dict)
    seconds: float = 0.0
    transpose: int = 0


def scale_of(mode: str | None) -> tuple[int, list[int]]:
    mode = mode or "Dmajor"
    for name, steps in MODES.items():
        if mode.lower().endswith(name):
            return TONICS.get(mode[: -len(name)], 2), steps
    return 2, MODES["major"]


def beat_shape(meter: str | None, kind: str | None, rng: np.random.Generator) -> tuple[int, np.ndarray]:
    """Beat length in units and the relative length of each quaver within the beat."""
    compound = (meter or "").split("/")[0] in ("6", "9", "12") or kind in ("jig", "slip jig", "slide")
    if compound:
        weights = np.array([1.0, 1.0, 1.0]) + rng.normal(0, 0.05, 3) + np.array([0.06, -0.06, 0.0]) * rng.uniform(0, 1.5)
        return 3 * QUAVER, weights / weights.sum()
    low, high = SWING.get(kind or "", (1.0, 1.1))
    ratio = rng.uniform(low, high)
    return 2 * QUAVER, np.array([ratio, 1.0]) / (ratio + 1.0)


def make_warp(beat: int, weights: np.ndarray, quaver_seconds: float):
    """Maps a position in units to seconds, stretching quavers inside each beat for lilt."""
    edges = np.concatenate([[0.0], np.cumsum(weights)])
    beat_seconds = quaver_seconds * beat / QUAVER

    def warp(units: float) -> float:
        beats, within = divmod(units, beat)
        slot = within / QUAVER
        index = min(int(slot), len(weights) - 1)
        return (beats + edges[index] + (slot - index) * weights[index]) * beat_seconds

    return warp


def neighbour(midi: int, direction: int, tonic: int, steps: list[int]) -> int:
    """Next note of the scale above or below."""
    candidate = midi + direction
    while (candidate - tonic) % 12 not in steps:
        candidate += direction
    return candidate


def play_melody(pitches, durations, start: int, length_seconds: float, instrument: Instrument, warp, transpose: int,
                tonic: int, steps: list[int], rng: np.random.Generator) -> tuple[list[Note], dict[int, float]]:
    notes: list[Note] = []
    onsets: dict[int, float] = {}
    position = 0.0
    jitter = rng.uniform(0.004, 0.015)
    for index in range(start, len(pitches)):
        begin, end = warp(position), warp(position + durations[index])
        position += durations[index]
        if begin > length_seconds:
            break
        midi = pitches[index] + transpose
        onset = max(0.0, begin + rng.normal(0, jitter))
        length = max(0.03, end - begin)
        onsets[index] = onset
        velocity = int(np.clip(rng.normal(88 if position % (QUAVER * 4) < 1e-6 else 76, 8), 40, 120))
        roll = durations[index] >= 2 * QUAVER and rng.random() < 0.35 * instrument.ornaments
        if rng.random() < 0.03:  # a player's own variation: a neighbouring note
            midi = neighbour(midi, int(rng.choice([-1, 1])), tonic, steps)
        if rng.random() < 0.015 and notes:  # left out, previous note held on
            notes[-1].duration += length
            continue
        bend = -rng.uniform(0.5, 1.5) if instrument.bends and rng.random() < 0.06 else 0.0
        if roll:
            grace = rng.uniform(0.022, 0.04)
            part = (length - 2 * grace) / 3
            upper, lower = neighbour(midi, 1, tonic, steps), neighbour(midi, -1, tonic, steps)
            sequence = [(midi, part), (upper, grace), (midi, part), (lower, grace), (midi, part)]
            if rng.random() < 0.3 and instrument.name in ("pipes", "flute", "low whistle"):  # cran
                sequence = [(midi, part)] + [(note, grace) for note in (upper + 2, midi, upper)] + [(midi, length - part - 3 * grace)]
            t = onset
            for pitch, span in sequence:
                notes.append(Note(t, max(0.015, span), pitch, velocity if span > grace else velocity - 15))
                t += span
        elif length > 0.09 and rng.random() < 0.12 * instrument.ornaments:
            grace = rng.uniform(0.02, 0.035)
            above = rng.random() < 0.75
            notes.append(Note(onset, grace, neighbour(midi, 1 if above else -1, tonic, steps) + (2 if above and rng.random() < 0.3 else 0), velocity - 15))
            notes.append(Note(onset + grace, length - grace, midi, velocity, bend))
        else:
            notes.append(Note(onset, length, midi, velocity, bend))
    return notes, onsets


def triads(tonic: int, steps: list[int]) -> list[tuple[int, list[int]]]:
    """Root and pitch classes of the chord on each scale degree."""
    return [((tonic + steps[d]) % 12, [(tonic + steps[(d + k) % 7]) % 12 for k in (0, 2, 4)]) for d in range(7)]


def harmonise(pitches, durations, start: int, warp, tonic: int, steps: list[int], span: int, length_seconds: float):
    """One chord per span of units, chosen to cover the melody's pitch classes, favouring I, IV and V."""
    chords = triads(tonic, steps)
    preference = [1.0, 0.55, 0.45, 0.85, 0.9, 0.6, 0.2]
    segments: list[tuple[float, float, list[int], int]] = []
    position, index, previous = 0.0, start, 0
    while index < len(pitches) and warp(position) < length_seconds:
        weight = np.zeros(12)
        end = position + span
        cursor = position
        while index < len(pitches) and cursor < end:
            weight[pitches[index] % 12] += durations[index]
            cursor += durations[index]
            index += 1
        scores = [sum(weight[pc] for pc in pcs) + preference[d] * span * 0.3 + (span * 0.15 if d == previous else 0) for d, (_, pcs) in enumerate(chords)]
        previous = int(np.argmax(scores))
        segments.append((warp(position), warp(cursor), chords[previous][1], chords[previous][0]))
        position = cursor
    return segments


def voicing(root: int, pcs: list[int], low: int, high: int) -> list[int]:
    bass = low + (root - low) % 12
    notes = [bass]
    for pc in pcs + [pcs[0]]:
        note = notes[-1] + 1
        while note % 12 != pc:
            note += 1
        if note <= high:
            notes.append(note)
    return notes


def play_backing(segments, beat: int, quaver_seconds: float, rng: np.random.Generator) -> list[Part]:
    parts: list[Part] = []
    style = rng.choice(["guitar", "bouzouki", "piano"], p=[0.5, 0.25, 0.25])
    beat_seconds = quaver_seconds * beat / QUAVER
    notes: list[Note] = []
    for begin, end, pcs, root in segments:
        t = begin
        strokes = 0
        while t < end - 0.02:
            if style == "piano":
                if strokes % 2 == 0:
                    notes.append(Note(t, beat_seconds * 0.9, 36 + (root - 36) % 12, int(rng.normal(80, 6))))
                else:
                    notes += [Note(t, beat_seconds * 0.6, n, int(rng.normal(66, 6))) for n in voicing(root, pcs, 55, 72)[1:]]
                t += beat_seconds
            else:
                low, high = (40, 64) if style == "guitar" else (43, 69)
                chord = voicing(root, pcs, low, high) if style == "guitar" else [n for n in voicing(root, pcs, low, high) if n % 12 in (root, pcs[2])]
                down = strokes % 2 == 0
                spread = rng.uniform(0.006, 0.014)
                for k, n in enumerate(chord if down else chord[::-1]):
                    notes.append(Note(t + k * spread, quaver_seconds * (1.8 if down else 0.9), n, int(np.clip(rng.normal(78 if down else 60, 8), 30, 110))))
                t += quaver_seconds * (1 if beat == 2 * QUAVER else 1.5)
            strokes += 1
    program = {"guitar": int(rng.choice([24, 25])), "bouzouki": 25, "piano": 0}[style]
    parts.append(Part(Instrument(str(style), program, 36, 84, 0), notes, rng.normal(0, 4)))
    if rng.random() < 0.35:  # bodhrán: low tom on beats, lighter strokes between
        drum = []
        t, stroke = segments[0][0], 0
        while t < segments[-1][1]:
            accent = stroke % (beat // QUAVER) == 0
            drum.append(Note(t, 0.1, 41 if accent else 43, int(np.clip(rng.normal(95 if accent else 65, 8), 30, 120))))
            t += quaver_seconds
            stroke += 1
        parts.append(Part(Instrument("bodhran", 0, 0, 127, 0), drum, drums=True))
    return parts


def perform(setting: dict, rng: np.random.Generator, seconds: float = 20.0, backing: float = 0.6) -> Performance:
    # Players go round a tune several times, so a late start wraps back to the top.
    pitches, durations = list(setting["pitches"]) * 3, list(setting["durations"]) * 3
    tune_length = len(setting["pitches"])
    kind = (setting.get("kind") or "").lower()
    tonic, steps = scale_of(setting.get("mode"))
    low, high = QUAVER_SECONDS.get(kind, (0.13, 0.19))
    quaver_seconds = rng.uniform(low, high)
    beat, weights = beat_shape(setting.get("meter"), kind, rng)
    warp = make_warp(beat, weights, quaver_seconds)
    # Start anywhere, but on a beat so the first notes sound like an entry.
    position, starts = 0, []
    for i in range(tune_length):
        if position % beat == 0:
            starts.append(i)
        position += durations[i]
    start = int(rng.choice(starts or [0]))

    count = int(rng.choice([1, 1, 1, 2, 2, 3]))
    instruments = [MELODY_INSTRUMENTS[i] for i in rng.choice(len(MELODY_INSTRUMENTS), count, replace=False)]
    # One key for the band: random transposition, then octaves to suit the lead instrument.
    transpose = int(rng.integers(-5, 7)) if rng.random() < 0.5 else 0
    lead = instruments[0]
    phrase = [p + transpose for p in pitches[start:start + 64]]
    while min(phrase) < lead.low and max(phrase) + 12 <= lead.high + 4:
        transpose += 12
        phrase = [p + 12 for p in phrase]
    while max(phrase) > lead.high + 4 and min(phrase) - 12 >= lead.low - 4:
        transpose -= 12
        phrase = [p - 12 for p in phrase]

    melody, onsets = [], {}
    for k, instrument in enumerate(instruments):
        notes, played = play_melody(pitches, durations, start, seconds, instrument, warp, transpose, (tonic + transpose) % 12, steps, rng)
        octave = 0 if k == 0 or min(n.midi for n in notes) >= instrument.low - 2 else 12
        for note in notes:
            note.midi += octave
            note.onset += rng.normal(0, 0.008) if k else 0.0
        melody.append(Part(instrument, notes, rng.normal(0, 6) if k else rng.normal(0, 3)))
        if k == 0:
            onsets = {index % tune_length: onset for index, onset in sorted(played.items(), reverse=True)}
        if instrument.drone:
            melody.append(Part(Instrument("drone", 109, 0, 127, 0), [Note(0.0, seconds + 1, 38 + (tonic + transpose) % 12, 60)], rng.normal(0, 3)))
    parts = play_backing(harmonise([p + transpose for p in pitches], durations, start, warp, (tonic + transpose) % 12, steps, beat * 2, seconds), beat, quaver_seconds, rng) if rng.random() < backing else []
    return Performance(melody, parts, onsets, seconds, transpose)
