"""Tune-level train/valid/test split, shared by synthetic training and the found-songs data."""

import zlib


def split_of(tune_id: int) -> str:
    bucket = zlib.crc32(str(tune_id).encode()) % 100
    return "train" if bucket < 90 else "valid" if bucket < 95 else "test"
