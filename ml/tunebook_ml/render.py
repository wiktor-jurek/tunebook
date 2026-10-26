"""Renders a Performance to 16 kHz audio: one FluidSynth pass per part with a random
SoundFont, then a session-like mix, room, background noise, phone microphone and codec.

    uv run python -m tunebook_ml.render 5901 out.wav    # Homer's, one random render
"""

import gzip
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import fluidsynth
import numpy as np
import soundfile
from scipy import signal

from tunebook_ml.performance import Part, Performance, perform

SAMPLE_RATE = 16000
ROOT = Path(__file__).parent.parent
SOUNDFONTS = sorted((ROOT / "cache" / "soundfonts").glob("*.sf2"))
BEND_RANGE = 2.0  # semitones, the General MIDI default
_synths: dict[Path, tuple] = {}


def bend_value(semitones: float) -> int:
    return int(np.clip(semitones / BEND_RANGE * 8192, -8192, 8191))


def synth_for(soundfont: Path):
    """One resident synthesiser per SoundFont and process: loading a font is the slow part."""
    if soundfont not in _synths:
        synth = fluidsynth.Synth(gain=0.6, samplerate=float(SAMPLE_RATE))
        synth.setting("synth.reverb.active", 0)
        synth.setting("synth.chorus.active", 0)
        _synths[soundfont] = (synth, synth.sfload(str(soundfont)))
    return _synths[soundfont]


def synthesise(part: Part, soundfont: Path, seconds: float) -> np.ndarray:
    synth, font = synth_for(soundfont)
    synth.system_reset()
    channel = 9 if part.drums else 0
    synth.program_select(channel, font, 128 if part.drums else 0, 0 if part.drums else part.instrument.program)
    detune = bend_value(part.detune_cents / 100)
    events: list[tuple[float, int, tuple]] = []
    for note in part.notes:
        key = int(np.clip(note.midi, 0, 127))
        if note.bend_from and not part.drums:
            # Slide: start flat and glide up to pitch over about 60 ms.
            events += [(note.onset + 0.012 * step, 0, ("bend", bend_value(note.bend_from * (1 - step / 5)) + detune)) for step in range(6)]
        events.append((note.onset, 2, ("on", key, int(note.velocity))))
        events.append((note.onset + max(note.duration, 0.005), 1, ("off", key)))
    synth.pitch_bend(channel, detune)
    length = int(seconds * SAMPLE_RATE)
    chunks, now = [], 0
    for time, _, event in sorted(events, key=lambda item: (item[0], item[1])):
        at = min(length, int(time * SAMPLE_RATE))
        if at > now:
            chunks.append(synth.get_samples(at - now))
            now = at
        if event[0] == "on":
            synth.noteon(channel, event[1], event[2])
        elif event[0] == "off":
            synth.noteoff(channel, event[1])
        else:
            synth.pitch_bend(channel, int(np.clip(event[1], -8192, 8191)))
    if length > now:
        chunks.append(synth.get_samples(length - now))
    stereo = np.concatenate(chunks).astype(np.float32).reshape(-1, 2) / 32768
    return stereo.mean(axis=1)


def room(rng: np.random.Generator) -> np.ndarray:
    """Synthetic impulse response: a few early reflections and an exponential tail."""
    rt60 = rng.uniform(0.15, 1.2)
    length = int(rt60 * SAMPLE_RATE)
    t = np.arange(length) / SAMPLE_RATE
    tail = rng.normal(0, 1, length) * np.exp(-6.9 * t / rt60)
    tail = signal.lfilter(*signal.butter(1, rng.uniform(2000, 6000), fs=SAMPLE_RATE), tail)
    response = tail * rng.uniform(0.05, 0.4)
    response[0] = 1.0
    for _ in range(int(rng.integers(2, 6))):
        response[int(rng.uniform(0.003, 0.03) * SAMPLE_RATE)] += rng.uniform(0.2, 0.6)
    return response / np.abs(response).sum() ** 0.5


def coloured_noise(length: int, rng: np.random.Generator) -> np.ndarray:
    """Pink-to-brown noise with slow swells, standing in for room and crowd noise."""
    spectrum = np.fft.rfft(rng.normal(0, 1, length))
    frequencies = np.fft.rfftfreq(length, 1 / SAMPLE_RATE)
    spectrum /= np.maximum(frequencies, 20) ** rng.uniform(0.5, 1.0)
    noise = np.fft.irfft(spectrum, length)
    swell = 1 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.05, 0.5) * np.arange(length) / SAMPLE_RATE + rng.uniform(0, 6))
    return (noise * swell / (np.std(noise) + 1e-9)).astype(np.float32)


def microphone(audio: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Phone microphone: high-pass, a random presence peak, gentle compression."""
    audio = signal.sosfilt(signal.butter(2, rng.uniform(60, 300), "highpass", fs=SAMPLE_RATE, output="sos"), audio)
    if rng.random() < 0.7:
        centre, gain = rng.uniform(800, 5000), rng.uniform(-6, 6)
        b, a = signal.iirpeak(centre, rng.uniform(0.7, 3), fs=SAMPLE_RATE)
        audio = audio + (10 ** (gain / 20) - 1) * signal.lfilter(b, a, audio)
    envelope = np.sqrt(signal.lfilter([0.002], [1, -0.998], audio ** 2) + 1e-9)
    threshold = np.percentile(envelope, rng.uniform(60, 90))
    return audio * np.minimum(1.0, (threshold / envelope) ** rng.uniform(0.0, 0.5))


def codec(audio: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Round trip through a low-bitrate Opus encode, as from a phone or a video upload."""
    with tempfile.TemporaryDirectory() as directory:
        source, encoded, decoded = (Path(directory) / name for name in ("in.wav", "out.opus", "out.wav"))
        soundfile.write(source, audio, SAMPLE_RATE)
        bitrate = f"{int(rng.choice([16, 24, 32, 48]))}k"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(source), "-c:a", "libopus", "-b:a", bitrate, str(encoded)], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(encoded), "-ar", str(SAMPLE_RATE), "-ac", "1", str(decoded)], check=True)
        result, _ = soundfile.read(decoded, dtype="float32")
    return np.pad(result, (0, max(0, len(audio) - len(result))))[: len(audio)]


def render(performance: Performance, rng: np.random.Generator, noise: bool = True) -> np.ndarray:
    seconds = performance.seconds + 1.0
    length = int(seconds * SAMPLE_RATE)
    mix = np.zeros(length, dtype=np.float32)
    for k, part in enumerate(performance.melody + performance.backing):
        audio = synthesise(part, SOUNDFONTS[int(rng.integers(len(SOUNDFONTS)))], seconds)
        level = np.sqrt(np.mean(audio ** 2)) + 1e-9
        if k < len(performance.melody):
            gain_db = 0.0 if k == 0 else rng.uniform(-6, 0)
        else:  # backing sits from well under to a little over the tune
            gain_db = rng.uniform(-12, 4)
        if part.instrument.name == "drone":
            gain_db = rng.uniform(-14, -6)
        mix += audio / level * 0.1 * 10 ** (gain_db / 20)
    return acoustics(mix, rng, reverb=0.85, noise=0.8 if noise else 0.0)


def acoustics(mix: np.ndarray, rng: np.random.Generator, reverb: float, noise: float) -> np.ndarray:
    """Room, noise, phone microphone, level and codec: everything between the players and the model."""
    length = len(mix)
    if rng.random() < reverb:
        wet = signal.fftconvolve(mix, room(rng))[:length]
        mix = (wet / (np.std(wet) + 1e-9) * np.std(mix)).astype(np.float32)
    if rng.random() < noise:
        snr = rng.uniform(5, 35)
        mix += coloured_noise(length, rng) * np.std(mix) * 10 ** (-snr / 20)
    if rng.random() < 0.7:
        mix = microphone(mix, rng)
    mix = (mix / (np.abs(mix).max() + 1e-9) * rng.uniform(0.3, 0.95)).astype(np.float32)
    if rng.random() < 0.3:
        mix = codec(mix, rng)
    return mix


def load_catalog(path: Path = ROOT / "data" / "catalog.jsonl.gz") -> list[dict]:
    with gzip.open(path, "rt") as handle:
        return [json.loads(line) for line in handle]


if __name__ == "__main__":
    tune_id, out = int(sys.argv[1]), sys.argv[2]
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    setting = next(row for row in load_catalog() if row["tuneId"] == tune_id)
    generator = np.random.default_rng(seed)
    performance = perform(setting, generator)
    print(f"{setting['title']}: {[part.instrument.name for part in performance.melody]} over {[part.instrument.name for part in performance.backing]}, transpose {performance.transpose}")
    soundfile.write(out, render(performance, generator), SAMPLE_RATE)
