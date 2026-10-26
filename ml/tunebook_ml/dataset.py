"""Training data for CLEWS-style version matching.

A clique is a The Session tune. Its versions come from three sources: fresh renders of
any of its settings (every tune, unlimited), YuE2 performances of it (realistic, exact
labels), and found recordings (real, mostly right labels). Pairs across sources are what
teach the model to keep the tune and ignore how it is played. Items follow CLEWS's
layout: [clique, id1, audio1, id2, audio2, ...]. Tunes are split by ID, so validation
and test tunes are never trained on; validation stays render-only so it is comparable
across runs, and the real-clip benchmark (eval/embedding.py) is the score that counts.
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

import soundfile

import numpy as np
import torch

from tunebook_ml.performance import perform
from tunebook_ml.render import ROOT, SAMPLE_RATE, acoustics, load_catalog, render
from tunebook_ml.splits import split_of


class TuneDataset(torch.utils.data.Dataset):
    # Loaded once in the parent process; DataLoader workers share it after fork.
    _tunes: dict[int, list[dict]] | None = None
    _recorded: dict[int, list[Path]] | None = None

    def __init__(self, conf, split, augment=False, fullsongs=False, checks=True, verbose=False):
        assert split in ("train", "valid", "test")
        self.split = split
        self.augment = augment
        self.seconds = float(conf.audiolen)
        self.n_per_class = int(conf.n_per_class)
        self.backing = float(conf.get("backing", 0.6))
        if TuneDataset._tunes is None:
            grouped: dict[int, list[dict]] = defaultdict(list)
            for row in load_catalog():
                grouped[row["tuneId"]].append({key: row[key] for key in ("pitches", "durations", "kind", "meter", "mode")})
            TuneDataset._tunes = dict(grouped)
        self.tune_ids = sorted(tune for tune in TuneDataset._tunes if split_of(tune) == split)
        if TuneDataset._recorded is None:
            TuneDataset._recorded = recorded_audio(conf)
        # Real-sounding audio is scarce next to renders: these set how often it is drawn.
        self.p_recorded_tune = float(conf.get("p_recorded_tune", 0.5))
        self.p_recorded_version = float(conf.get("p_recorded_version", 0.5))
        self.recorded_ids = sorted(tune for tune in TuneDataset._recorded if split_of(tune) == split) if split == "train" else []
        if split == "train":
            self.length = int(conf.get("epoch_size", 20000))
        else:
            # Each tune contributes several items so retrieval has true matches to find.
            self.tune_ids = self.tune_ids[: int(conf.get("valid_tunes", 500))]
            self.versions = int(conf.get("valid_versions", 3))
            self.length = len(self.tune_ids) * self.versions
        self.clique_offset = {"train": 0, "valid": 1_000_000, "test": 2_000_000}[split]
        if verbose:
            clips = sum(len(TuneDataset._recorded[tune]) for tune in self.recorded_ids)
            print(f"  {split}: {len(self.tune_ids)} tunes, {self.length} items per epoch; {clips} recorded clips of {len(self.recorded_ids)} tunes")

    def __len__(self):
        return self.length

    def performance(self, tune_id: int, rng: np.random.Generator) -> torch.Tensor:
        settings = TuneDataset._tunes[tune_id]
        for _ in range(5):
            try:
                audio = render(perform(settings[int(rng.integers(len(settings)))], rng, seconds=self.seconds, backing=self.backing), rng)
                break
            except Exception:  # an unplayable setting; try another performance
                continue
        else:
            audio = np.zeros(int(self.seconds * SAMPLE_RATE), dtype=np.float32)
        length = int(self.seconds * SAMPLE_RATE)
        return torch.from_numpy(np.pad(audio, (0, max(0, length - len(audio))))[:length].copy())

    def recording(self, tune_id: int, rng: np.random.Generator) -> torch.Tensor:
        """A random window of one of the tune's recorded clips, through the same acoustics as renders."""
        path = TuneDataset._recorded[tune_id][int(rng.integers(len(TuneDataset._recorded[tune_id])))]
        length = int(self.seconds * SAMPLE_RATE)
        try:
            info = soundfile.info(path)
            start = int(rng.integers(max(1, info.frames - length)))
            audio, rate = soundfile.read(path, start=start, frames=length, dtype="float32", always_2d=True)
            audio = audio.mean(axis=1)
            assert rate == SAMPLE_RATE and len(audio) > SAMPLE_RATE
        except Exception:  # unreadable clip: fall back to a render
            return self.performance(tune_id, rng)
        audio = np.pad(audio, (0, max(0, length - len(audio))), mode="wrap")[:length]
        # Recordings already have a room and a microphone; add them only sometimes.
        audio = acoustics(audio, rng, reverb=0.3, noise=0.5) if self.augment else audio
        return torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32))

    def __getitem__(self, idx):
        if self.split == "train":
            rng = np.random.default_rng([torch.initial_seed() % 2**32, idx])
            pool = self.recorded_ids if self.recorded_ids and rng.random() < self.p_recorded_tune else self.tune_ids
            tune_id = pool[int(rng.integers(len(pool)))]
            seeds = [None] * self.n_per_class
        else:
            tune_id = self.tune_ids[idx // self.versions]
            version = idx % self.versions
            # Fixed renders, so validation numbers are comparable across epochs.
            seeds = [[tune_id, version]] + [[tune_id, 100 + k] for k in range(self.n_per_class - 1)]
            rng = None
        output = [self.clique_offset + tune_id]
        recorded = self.split == "train" and tune_id in TuneDataset._recorded
        for k in range(self.n_per_class):
            generator = rng if seeds[k] is None else np.random.default_rng(seeds[k])
            # With recordings, keep at least one render and one recording so each item crosses sources.
            use_recording = recorded and (k == 0 or (k > 1 and generator.random() < self.p_recorded_version))
            audio = self.recording(tune_id, generator) if use_recording else self.performance(tune_id, generator)
            output += [(self.clique_offset + tune_id) * 1000 + (idx % 1000 if k == 0 else 900 + k), audio]
        return output


def recorded_audio(conf) -> dict[int, list[Path]]:
    """Recorded clips by tune: YuE2 renders (index-*.jsonl beside the clips) and found songs (manifest.jsonl).

    Benchmark tunes are never included, whatever the manifests say."""
    clips: dict[int, list[Path]] = defaultdict(list)
    for directory in conf.get("yue", None) or []:
        directory = ROOT / directory
        for index in directory.glob("index-*.jsonl"):
            for line in index.open():
                row = json.loads(line)
                if row["status"] == "ok" and not row.get("truncated") and (directory / f"{row['name']}.ogg").exists():
                    clips[int(row["tune_id"])].append(directory / f"{row['name']}.ogg")
    found = conf.get("found", None)
    if found and (ROOT / found).exists():
        for line in (ROOT / found).open():
            row = json.loads(line)
            if row["split"] != "benchmark":
                clips[int(row["tune_id"])].append((ROOT / found).parent / row["audio"])
    with (ROOT / "eval" / "youtube.csv").open() as handle:
        benchmark = {int(row["tune_id"]) for row in csv.DictReader(handle) if row["tune_id"].isdigit()}
    return {tune: paths for tune, paths in clips.items() if tune not in benchmark}
