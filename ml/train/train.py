"""Runs sony/clews's own training loop on rendered Session performances.

Two substitutions, made before CLEWS's train.py runs: its dataset becomes
TuneDataset, and model "tunebook_clews" is CLEWS's model initialised from a
DiscogsVI checkpoint (weights only, so epochs, optimiser and schedule start fresh).

    cd ml/cache/clews && python ../../train/train.py jobname=ft1 conf=../../train/tunebook-clews.yaml init_weights=...
"""

import runpy
import sys
import types
from pathlib import Path

import torch
from omegaconf import OmegaConf

ML = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ML), str(Path.cwd())]

from lib import dataset  # noqa: E402  (CLEWS's modules, importable from its checkout)
from models import clews  # noqa: E402

from tunebook_ml.dataset import TuneDataset  # noqa: E402

dataset.Dataset = TuneDataset
init_weights = OmegaConf.from_cli().get("init_weights")


class Model(clews.Model):
    def __init__(self, conf, sr=16000, **kwargs):
        super().__init__(conf, sr=sr, **kwargs)
        if init_weights:
            state = torch.load(init_weights, map_location="cpu", weights_only=False)
            state = state.get("model", state.get("state_dict", state))
            state = {key.removeprefix("_forward_module.").removeprefix("module."): value for key, value in state.items()}
            missing, unexpected = self.load_state_dict(state, strict=False)
            print(f"Initialised from {init_weights}: {len(missing)} missing, {len(unexpected)} unexpected keys")


sys.modules["models.tunebook_clews"] = types.SimpleNamespace(Model=Model)
sys.argv = [sys.argv[0], *[argument for argument in sys.argv[1:] if not argument.startswith("init_weights=")]]
runpy.run_path("train.py", run_name="__main__")
