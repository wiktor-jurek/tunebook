"""Simulated semitone spectrograms: a Performance straight to what pitchclass.semitones
would measure from its audio, without synthesising any sound. About a thousand times
faster than rendering, so the classifier can see millions of performances.

What is modelled: each instrument's partials and envelope, the band's levels, backing
chords that HPSS only partly removes, bends and vibrato smearing into the next semitone,
drones, the STFT's time smear, room reverb, a phone microphone's tilt and high-pass, and
noise with the exponential speckle of a real power spectrum.

    uv run python -m tunebook_ml.simulate 5901 out.png   # Homer's, simulated next to its render
"""

import numpy as np
from scipy.signal import oaconvolve

from tunebook_ml.performance import Performance, perform
from tunebook_ml.pitchclass import FPS

OFFSETS = np.array([0, 12, 19, 24, 28, 31])  # partials 1-6 in semitones
# Amplitude ranges of partials 1-6 by family: wind is nearly pure, bowed and reeds are rich.
TIMBRES = {
    "wind": [(1, 1), (0.2, 0.6), (0.05, 0.3), (0.02, 0.15), (0, 0.08), (0, 0.05)],
    "bowed": [(1, 1), (0.5, 1.0), (0.4, 0.9), (0.2, 0.6), (0.1, 0.5), (0.1, 0.4)],
    "reed": [(1, 1), (0.6, 1.0), (0.5, 0.9), (0.3, 0.7), (0.2, 0.6), (0.2, 0.5)],
    "plucked": [(1, 1), (0.4, 0.8), (0.2, 0.6), (0.1, 0.4), (0.05, 0.3), (0, 0.2)],
}
FAMILY = {"fiddle": "bowed", "flute": "wind", "whistle": "wind", "low whistle": "wind", "recorder": "wind",
          "pipes": "reed", "drone": "reed", "accordion": "reed", "concertina": "reed", "harmonica": "reed",
          "banjo": "plucked", "mandolin": "plucked", "piano": "plucked", "guitar": "plucked", "bouzouki": "plucked"}
PLUCKED = {"banjo", "mandolin", "piano", "guitar", "bouzouki"}


def _db(value: float) -> float:
    return 10 ** (value / 10)


def spectrogram(performance: Performance, rng: np.random.Generator, frames: int) -> np.ndarray:
    """(128, frames) semitone power of the performance as heard through a phone."""
    power = np.zeros((128 + 32, frames + 64), dtype=np.float32)  # headroom for partials and release tails
    parts = [(p, "melody", k) for k, p in enumerate(performance.melody)] + [(p, "backing", 0) for p in performance.backing]
    for part, role, k in parts:
        name = part.instrument.name
        if part.drums:  # HPSS keeps little of a bodhrán: faint broadband clicks
            level = rng.uniform(0, 0.03)
            for note in part.notes:
                f = int(note.onset * FPS)
                if 0 <= f < frames:
                    power[30:110, f:f + 2] += level * (note.velocity / 90) ** 2
            continue
        if role == "melody":
            gain = 0.0 if k == 0 else rng.uniform(-6, 0)
        else:
            gain = rng.uniform(-12, 4) + 10 * np.log10(rng.uniform(0.15, 0.8))  # HPSS strips much of a strum
        if name == "drone":
            gain = rng.uniform(-14, -6)
        timbre = np.array([rng.uniform(lo, hi) for lo, hi in TIMBRES[FAMILY.get(name, "reed")]]) ** 2
        plucked = name in PLUCKED
        decay = rng.uniform(0.12, 0.5)
        attack = rng.uniform(0.01, 0.05)
        smear = rng.uniform(0.0, 0.15) if name in ("fiddle", "flute", "low whistle", "pipes") else rng.uniform(0, 0.06)
        sag = rng.uniform(0.3, 3.0)  # sustained notes still fade a little after the attack
        level = _db(gain) * (1.0 / timbre.sum())
        fundamental = np.zeros_like(power)
        articulation = rng.uniform(0.6, 1.0)  # how much of each note's slot sounds: tonguing, bow changes
        for note in part.notes:
            length = max(note.duration * (articulation if not plucked else 1.0), 0.02)
            if plucked:
                t = np.arange(int((length + 0.15) * FPS) + 1) / FPS
                env = np.exp(-2 * t / decay) * np.where(t > length, np.exp(-2 * (t - length) / 0.05), 1.0)
            else:
                release = rng.uniform(0.03, 0.08)
                t = np.arange(int((length + release) * FPS) + 1) / FPS
                env = (np.minimum(1.0, (t + 1 / FPS) / attack) * np.exp(-t / sag) * np.where(t > length, np.exp(-(t - length) / release), 1.0)) ** 2
            f0 = int(round(note.onset * FPS))
            lo, hi = max(0, f0), min(frames + 64, f0 + len(env))
            if lo >= hi:
                continue
            env = env[lo - f0:hi - f0] * (note.velocity / 90) ** 2 * rng.lognormal(0, 0.35)  # players shape every note
            midi = int(np.clip(note.midi, 1, 126))
            fundamental[midi, lo:hi] += env
            if note.bend_from:  # the first few frames sit a semitone flat
                n = min(3, hi - lo)
                fundamental[midi, lo:lo + n] -= 0.7 * env[:n]
                fundamental[midi - 1, lo:lo + n] += 0.7 * env[:n]
        if not plucked:  # bow and breath pressure wander
            fundamental *= rng.uniform(0.85, 1.15, fundamental.shape[1])[None, :]
        fundamental *= level
        rows = len(fundamental)
        for offset, weight in zip(OFFSETS, timbre):
            target = power[offset:]
            source = fundamental[: rows - offset] * weight
            target += source * (1 - 2 * smear)
            target[1:] += source[:-1] * smear
            target[:-1] += source[1:] * smear
    power = power[:128, :frames + 64]

    # The STFT window spreads each frame over about ±60 ms.
    kernel = np.hanning(7) ** 2
    power = oaconvolve(power, (kernel / kernel.sum())[None, :], mode="same", axes=1)
    if rng.random() < 0.85:  # room: an exponential tail mixed under the dry sound
        tau = rng.uniform(0.05, 0.6)
        tail = np.exp(-np.arange(int(3 * tau * FPS) + 1) / (tau * FPS))
        wet = oaconvolve(power, (tail / tail.sum())[None, :], mode="full", axes=1)[:, : power.shape[1]]
        mix = rng.uniform(0.05, 0.4)
        power = (1 - mix) * power + mix * wet
    power = np.maximum(power, 0)
    power = power[:, :frames]

    signal = power.mean() + 1e-12
    if rng.random() < 0.9:  # noise: sloped spectrum, slow swells, exponential speckle
        snr = rng.uniform(3, 35)
        slope = 10 ** (-rng.uniform(0.5, 1.5) * (np.arange(128) - 60) / 12 / 10 * 3)
        swell = 1 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.05, 0.5) * np.arange(frames) / FPS + rng.uniform(0, 6))
        noise = slope[:, None] * swell[None, :] * rng.exponential(1.0, (128, frames))
        power += noise / noise.mean() * signal * _db(-snr)
    if rng.random() < 0.7:  # phone microphone: tilt and high-pass
        tilt = rng.uniform(-3, 3) * (np.arange(128) - 69) / 12
        cutoff = rng.uniform(35, 62)
        highpass = 1 / (1 + (cutoff / np.maximum(np.arange(128), 1)) ** 24)
        power *= (_db(tilt) * highpass)[:, None]
    return power.astype(np.float32)


def rests(performance: Performance, rng: np.random.Generator) -> None:
    """Silence real windows have and renders don't: breaths, a pause between tunes, or the
    window starting before the band does."""
    if rng.random() < 0.15:
        lead_in = rng.uniform(0.3, 3.0)
        for part in performance.melody + performance.backing:
            part.notes = [n for n in part.notes if n.onset >= lead_in]
    if rng.random() < 0.3:
        start = rng.uniform(0, performance.seconds)
        end = start + rng.uniform(0.2, 1.5)
        for part in performance.melody:
            part.notes = [n for n in part.notes if not start <= n.onset < end]


def simulate(setting: dict, rng: np.random.Generator, seconds: float = 8.0, backing: float = 0.6) -> np.ndarray:
    performance = perform(setting, rng, seconds=seconds + 0.5, backing=backing)
    rests(performance, rng)
    return spectrogram(performance, rng, int(round(seconds * FPS)))


if __name__ == "__main__":
    import sys

    import matplotlib.pyplot as plt
    import torch

    from tunebook_ml import pitchclass
    from tunebook_ml.render import load_catalog, render

    tune_id, out = sys.argv[1], sys.argv[2]
    setting = next(row for row in load_catalog() if row["tuneId"] == int(tune_id))
    rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 0)
    performance = perform(setting, rng, seconds=8.5)
    simulated = torch.from_numpy(spectrogram(performance, np.random.default_rng(1), 400))[None]
    audio = torch.from_numpy(render(performance, rng))[None, : 8 * 16000]
    measured = pitchclass.semitones(audio)[:, :, :400]
    fig, axes = plt.subplots(2, 1, figsize=(12, 5))
    for ax, semis, label in zip(axes, (simulated, measured), ("simulated", "rendered")):
        ax.imshow(pitchclass.features(semis, canon=False)[0].numpy(), aspect="auto", origin="lower")
        ax.set_title(label)
    fig.savefig(out)
