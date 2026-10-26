"""Where the tune is playing in a recording, without knowing which tune it is.

Held notes leave spectral peaks that stay on one frequency for a note's length; speech
glides between pitches and noise has no stable peaks. The share of energy in peaks that
hold for at least 160 ms, smoothed over a second, gives a 0–1 music score per frame.
On the first clips, speech stayed under about 0.5 and tunes over about 0.7.
It never looks at the label, so trimming with it doesn't favour clips an engine likes.

    uv run python eval/music_activity.py cache/youtube/source/Lh2sxcqkJ6I.flac
"""

import sys

import numpy as np
import soundfile
from scipy import ndimage, signal

SAMPLE_RATE = 16000
HOP = 320  # 20 ms frames
FPS = SAMPLE_RATE / HOP
HOLD_FRAMES = 8  # a peak must stay within a bin of where it was for 160 ms


def music_score(audio: np.ndarray) -> np.ndarray:
    """Per-frame music likelihood in [0, 1] at FPS frames per second."""
    _, _, spectrum = signal.stft(audio, SAMPLE_RATE, nperseg=2048, noverlap=2048 - HOP, boundary=None)
    power = np.abs(spectrum[16:640]) ** 2  # about 125 Hz to 5 kHz, where melody harmonics sit
    db = 10 * np.log10(power + 1e-12)
    floor = np.median(db, axis=0, keepdims=True)
    peaks = (db > np.roll(db, 1, 0)) & (db >= np.roll(db, -1, 0)) & (db > floor + 12)
    near = ndimage.binary_dilation(peaks, structure=np.ones((3, 1), bool))
    held = ndimage.binary_erosion(near, structure=np.ones((1, HOLD_FRAMES), bool), border_value=0)
    held = ndimage.binary_dilation(held, structure=np.ones((1, HOLD_FRAMES), bool)) & peaks
    # Energy in a peak's neighbouring bins counts with it: a Hann window spreads each partial.
    tonal = (power * ndimage.binary_dilation(held, structure=np.ones((3, 1), bool))).sum(axis=0)
    share = tonal / (power.sum(axis=0) + 1e-12)
    level = 10 * np.log10(power.sum(axis=0) + 1e-12)
    share[level < np.percentile(level, 99) - 45] = 0  # silence
    return ndimage.uniform_filter1d(share, int(FPS))


def suggest(score: np.ndarray, length: float = 15.0, threshold: float = 0.6, settle: float = 4.0) -> tuple[float, float]:
    """Start of the first passage that stays musical for `settle` seconds, and an end
    `length` seconds later or where the music stops for more than 1.5 s, if sooner."""
    music = ndimage.binary_closing(score > threshold, structure=np.ones(int(0.5 * FPS), bool))
    run = int(settle * FPS)
    starts = np.flatnonzero(np.convolve(music, np.ones(run), "valid") >= run)
    begin = int(starts[0]) if len(starts) else int(np.argmax(ndimage.uniform_filter1d(score, run)))
    gap = int(1.5 * FPS)
    end = min(len(score), begin + int(length * FPS))
    quiet = np.flatnonzero(np.convolve(~music[begin:end], np.ones(gap), "valid") >= gap)
    if len(quiet):
        end = begin + int(quiet[0])
    return round(begin / FPS, 1), round(end / FPS, 1)


def analyse(path) -> dict:
    audio, rate = soundfile.read(path, dtype="float32")
    assert rate == SAMPLE_RATE, rate
    score = music_score(audio)
    start, end = suggest(score)
    step = int(FPS / 4)  # 4 values per second is plenty for drawing
    return {"seconds": len(audio) / SAMPLE_RATE, "score_fps": FPS / step, "score": np.round(score[::step], 2).tolist(),
            "suggested": {"start": start, "end": end}}


if __name__ == "__main__":
    for path in sys.argv[1:]:
        result = analyse(path)
        timeline = "".join(" .:-=+*#%@"[min(9, int(v * 10))] for v in result["score"][::2])
        print(f"{path.split('/')[-1][:11]} start={result['suggested']['start']:5.1f} end={result['suggested']['end']:5.1f}  {timeline[:120]}")
