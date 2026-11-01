"""Re-ranking by alignment: does the heard pitch-class sequence follow this setting's
melody, note after note, at some tempo and in some key?

The classifier answers "which tune does this sound like"; alignment answers "where in
which setting are we", which separates tunes that share a key, a rhythm and half their
phrases. For each candidate setting it runs a subsequence DTW of the clip's pitch-class
frames against the setting's melody (twice round, so a clip may cross the end), in every
transposition, and reports the best mean cosine along the path.
"""

import numba
import numpy as np

from tunebook_ml.pitchclass import FPS

ALIGN_FPS = 12.5  # frames are averaged in fours: enough for quavers at reel tempo
QUAVER_SECONDS = {"reel": 0.135, "hornpipe": 0.15, "barndance": 0.16, "strathspey": 0.18, "jig": 0.14, "slip jig": 0.15,
                  "slide": 0.115, "polka": 0.14, "waltz": 0.21, "mazurka": 0.2, "march": 0.17, "three-two": 0.15}


def clip_sequence(windows: np.ndarray, hop_seconds: float = 1.0) -> np.ndarray:
    """(N, 12, T) overlapping 8 s windows, one a second → (12, frames) for the whole clip at ALIGN_FPS."""
    hop = int(hop_seconds * FPS)
    parts = [windows[0]] + [w[:, -hop:] for w in windows[1:]]
    seq = np.concatenate(parts, axis=1)
    usable = seq.shape[1] // 4 * 4
    return seq[:, :usable].reshape(12, -1, 4).mean(axis=2)


def template(pitches: list[int], durations: list[int], kind: str | None, starts: list[int] | None = None) -> np.ndarray:
    """(12, frames) pitch classes of the setting played twice round at its type's usual tempo.
    Notes are placed by `starts` when given, so rests stay silent; otherwise back to back."""
    quaver = QUAVER_SECONDS.get((kind or "").lower(), 0.15)
    frames_per_unit = quaver * ALIGN_FPS / 6
    if not starts:
        starts = np.concatenate([[0], np.cumsum(durations[:-1])]).tolist()
    origin = starts[0]
    length = max(t + d for t, d in zip(starts, durations)) - origin
    total = int(np.ceil(length * frames_per_unit)) + 1
    one = np.zeros((12, total), dtype=np.float32)
    for midi, duration, at in zip(pitches, durations, starts):
        position = at - origin
        start, end = int(position * frames_per_unit), max(int(position * frames_per_unit) + 1, int((position + duration) * frames_per_unit))
        one[midi % 12, start:end] = 1.0
    one = one[:, : int(np.ceil(length * frames_per_unit))]
    return np.concatenate([one, one], axis=1)


@numba.njit(cache=True)
def _subsequence_dtw(similarity: np.ndarray, penalty: float) -> float:
    """Best mean similarity of a path that takes every query frame (rows) once and moves
    0, 1 or 2 template frames (columns) each time, starting and ending anywhere in the
    template. Holding or skipping costs `penalty`, so tempo can drift but not freeze."""
    n, m = similarity.shape
    previous = similarity[0].copy()
    current = np.empty(m)
    for i in range(1, n):
        for j in range(m):
            best = previous[j] - penalty
            if j >= 1 and previous[j - 1] > best:
                best = previous[j - 1]
            if j >= 2 and previous[j - 2] - penalty > best:
                best = previous[j - 2] - penalty
            current[j] = best + similarity[i, j]
        previous, current = current, previous
    return previous.max() / n


def score(sequence: np.ndarray, settings: list[dict]) -> float:
    """Best alignment of the clip (12, frames) to any of a tune's settings, in any key."""
    q = sequence / (np.linalg.norm(sequence, axis=0, keepdims=True) + 1e-6)
    best = -1.0
    for setting in settings:
        t = template(setting["pitches"], setting["durations"], setting.get("kind"), setting.get("starts"))
        if t.shape[1] < 2:
            continue
        for shift in range(12):
            similarity = np.ascontiguousarray(np.roll(q, shift, axis=0).T @ t, dtype=np.float64)
            best = max(best, _subsequence_dtw(similarity, 0.1))
    return best
