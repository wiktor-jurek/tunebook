"""The classifier's front end: audio → semitone spectrogram → harmonic salience → 12 pitch
classes, normalised and rotated to a canonical key.

Real audio and simulated performances (tunebook_ml.simulate) meet at the semitone
spectrogram, so everything after it (`features`) is the same code for both. Percussive
energy (strums, bodhrán, consonants of bowing) is removed with median-filter HPSS before
the semitone map, and only fundamentals from G3 to C7 are kept, below which sit the
guitar, bouzouki and bass parts.

Shapes: audio (B, samples) at 16 kHz → semitones (B, 128, T) → features (B, 12, T), 50 frames a second.
"""

import math

import torch
import torch.nn.functional as F

SAMPLE_RATE = 16000
N_FFT = 2048
HOP = 320
FPS = SAMPLE_RATE / HOP  # 50
MELODY_LOW, MELODY_HIGH = 55, 96  # G3 .. C7, fundamentals the melody instruments play
HARMONICS = ((0, 1.0), (12, 0.6), (19, 0.4), (24, 0.3))  # semitone offset and weight of partials 1-4
LOG_GAIN = 100.0


def _semitone_filters(device) -> torch.Tensor:
    """(128, N_FFT//2+1) triangular filters, one per MIDI note, a semitone either side."""
    freqs = torch.arange(N_FFT // 2 + 1, device=device) * SAMPLE_RATE / N_FFT
    midi = 69 + 12 * torch.log2(freqs.clamp(min=1.0) / 440.0)
    centres = torch.arange(128, device=device, dtype=torch.float32)[:, None]
    filters = (1 - (midi[None, :] - centres).abs()).clamp(min=0)
    filters[:, 0] = 0
    return filters / filters.sum(dim=1, keepdim=True).clamp(min=1e-6)


def _median(x: torch.Tensor, kernel: int, dim: int) -> torch.Tensor:
    x = x.transpose(dim, -1)
    padded = F.pad(x, (kernel // 2, kernel // 2), mode="reflect")
    return padded.unfold(-1, kernel, 1).median(dim=-1).values.transpose(dim, -1)


_filters: dict = {}


def semitones(audio: torch.Tensor) -> torch.Tensor:
    """Harmonic part of the spectrum mapped to MIDI semitones: (B, samples) → (B, 128, T) power."""
    window = torch.hann_window(N_FFT, device=audio.device)
    spec = torch.stft(audio, N_FFT, HOP, window=window, center=True, return_complex=True).abs()  # (B, F, T)
    harmonic = _median(spec, 9, dim=2)  # across time: sustained tones survive
    percussive = _median(spec, 17, dim=1)  # across frequency: broadband clicks survive
    mask = harmonic ** 2 / (harmonic ** 2 + percussive ** 2 + 1e-10)
    key = str(audio.device)
    if key not in _filters:
        _filters[key] = _semitone_filters(audio.device)
    return torch.einsum("mf,bft->bmt", _filters[key], (spec * mask) ** 2)


def features(semis: torch.Tensor, canon: bool = True) -> torch.Tensor:
    """(B, 128, T) semitone power → (B, 12, T) pitch-class salience in [0, 1], bin 0 = C."""
    level = semis.flatten(1).quantile(0.995, dim=1).clamp(min=1e-10)[:, None, None]
    logs = torch.log1p(LOG_GAIN * semis / level)
    salience = sum(weight * logs[:, MELODY_LOW + offset:MELODY_HIGH + 1 + offset] for offset, weight in HARMONICS)
    # Fold octaves: MIDI 55 is G, so bin k of the slice is pitch class (7 + k) % 12.
    pcs = torch.zeros(semis.shape[0], 12, semis.shape[2], device=semis.device)
    pcs.index_add_(1, (torch.arange(salience.shape[1], device=semis.device) + MELODY_LOW) % 12, salience)
    # A tone held through the whole window (drone, hum) is not melody.
    pcs = (pcs - pcs.min(dim=2, keepdim=True).values).clamp(min=0)
    pcs = pcs / pcs.flatten(1).quantile(0.99, dim=1).clamp(min=1e-6)[:, None, None]
    pcs = pcs.clamp(max=1.0)
    return keycanon(pcs) if canon else pcs


def key_shift(pcs: torch.Tensor) -> torch.Tensor:
    """Rotation that puts each window's pitch-class profile in a canonical position: the
    phase of the profile's first Fourier coefficient, so any transposition maps to one input."""
    profile = pcs.sum(dim=2)  # (B, 12)
    k = torch.arange(12, device=pcs.device, dtype=torch.float32)
    re = (profile * torch.cos(2 * math.pi * k / 12)).sum(1)
    im = (profile * -torch.sin(2 * math.pi * k / 12)).sum(1)
    phase = torch.atan2(im, re)
    return torch.round(-phase * 12 / (2 * math.pi)).long() % 12


def keycanon(pcs: torch.Tensor, extra: int = 0) -> torch.Tensor:
    shift = (key_shift(pcs) + extra) % 12
    index = (torch.arange(12, device=pcs.device)[None, :] + shift[:, None]) % 12  # (B, 12)
    return torch.gather(pcs, 1, index[:, :, None].expand(-1, -1, pcs.shape[2]))


def from_audio(audio: torch.Tensor, canon: bool = True) -> torch.Tensor:
    return features(semitones(audio), canon)
