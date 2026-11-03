"""Export a classifier checkpoint for the in-browser Tune finder.

    python train/export_finder.py export runs/classifier/x/last.pt out/      # model.onnx, tunes.json, popularity.json, features.fixture.json
    python train/export_finder.py quantize out/                              # model.int8.onnx (needs onnxruntime)
    python train/export_finder.py quantize out/ --head-bits 4                # also model.int4head.onnx: the head at 4 bits
    python train/export_finder.py check runs/classifier/x/last.pt out/       # ONNX vs torch on the real clips, and confidence

The shipped finder adds --one-centre --sim-centres <prototypes.pt> --sim-parts 8 --dim 192
--hub-reference cache/classifier/found_train.pt to export and check.

The browser computes the pitch-class features itself (apps/web/src/lib/finder/features.ts, a port of
tunebook_ml/pitchclass.py) and feeds the model KeyCanon'd (B, 12, 400) windows; the model
returns each tune's best-centre cosine, (B, tunes). Column i is tunes.json[i], a The Session tune id.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
import classifier as c  # noqa: E402
from tunebook_ml import pitchclass  # noqa: E402

def embed(model: c.Classifier, windows: torch.Tensor) -> torch.Tensor:
    """The model's unit embedding, projected onto the head's dimensions when load(dim=...) shrank it."""
    z = model.embed(windows)
    return z if model.shrink is None else F.normalize(z @ model.shrink, dim=-1)


class Finder(nn.Module):
    """Embedding plus every tune's cosine, with the class weights normalised once at export."""

    def __init__(self, model: c.Classifier):
        super().__init__()
        self.model = model
        self.register_buffer("weight", F.normalize(model.weight.detach(), dim=-1))
        self.register_buffer("offset", model.offset)

    def forward(self, windows: torch.Tensor) -> torch.Tensor:
        z = embed(self.model, windows)
        cos = z @ self.weight.T
        return cos.view(cos.shape[0], -1, self.model.centres).amax(dim=-1) - self.offset


def load(path: str, one_centre: bool = False, sim_centres: str | None = None, sim_offset: float = 0.0,
         sim_parts: int = 0, dim: int = 0, hub_reference: str | None = None, hub_weight: float = 1.0) -> tuple[c.Classifier, dict]:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    a = ckpt["args"]
    channels = a.get("channels", 12)
    assert channels == pitchclass.CHANNELS, f"{path} takes {channels}-channel features: set TUNEBOOK_FEATURES={'height' if channels == 24 else ''}"
    model = c.Classifier(len(ckpt["tune_ids"]), a["width"], a["layers"], a["heads"], a["dim"], a["centres"], a.get("stride", 4), channels)
    model.load_state_dict(ckpt["model"])
    if one_centre and model.centres > 1:
        # A tune's sub-centres are nearly one vector (cosine 0.97): their mean scores as well and
        # makes the head, most of the download, a third of the size (PIPELINE.md §9).
        centres = F.normalize(model.weight.detach().view(-1, model.centres, model.weight.shape[1]), dim=-1)
        model.weight = nn.Parameter(F.normalize(centres.mean(1), dim=-1))
        model.centres = 1
    model.offset = torch.zeros(len(ckpt["tune_ids"]))  # subtracted from each tune's cosine
    model.shrink = None  # (384, dim) when the head is shrunk
    if sim_centres and sim_parts:
        # Every tune takes `sim_parts` simulated centres, one per stretch of the tune (neighbouring
        # parts of the saved prototypes merged when fewer are asked for), scored by the best: better on real audio than the learned head
        # for every tune, YuE2 audio or not (PIPELINE.md §9). Empty parts repeat the tune's fullest part;
        # a tune with no simulated windows keeps its learned centre.
        sim = torch.load(sim_centres, map_location="cpu")
        assert model.centres == 1 and sim["tune_ids"] == ckpt["tune_ids"], "needs --one-centre and the same tunes"
        eighths, counts = sim["per_eighth"].float(), sim["counts"].float()
        group = eighths.shape[1] // sim_parts
        sums = (eighths * counts[..., None]).view(len(eighths), sim_parts, group, -1).sum(2)
        counts = counts.view(len(eighths), sim_parts, group).sum(2)
        parts = F.normalize(sums, dim=-1)
        fullest = parts[torch.arange(len(parts)), counts.argmax(1)]
        parts = torch.where((counts > 0)[..., None], parts, fullest[:, None])
        head = F.normalize(model.weight.detach(), dim=-1)
        parts = torch.where((counts.sum(1) > 0)[:, None, None], parts, head[:, None])
        model.weight = nn.Parameter(parts.reshape(-1, parts.shape[2]))
        model.centres = sim_parts
        if dim and dim < parts.shape[2]:
            # The head is most of the download: score in the top `dim` directions of the simulated
            # centres (uncentred PCA, no eval data). Projection is linear, so a projected centre is
            # still the mean direction of its projected windows. 192 of 384 cost nothing measurable
            # on the real clips (PIPELINE.md, "how small the head can get").
            flat = sim["per_eighth"].float()[sim["counts"] > 0]
            _, _, vh = torch.linalg.svd(flat.T @ flat / len(flat))
            model.shrink = vh[:dim].T.contiguous()
            model.weight = nn.Parameter(F.normalize(model.weight.detach() @ model.shrink, dim=-1))
    elif sim_centres:
        # Tunes without YuE2 audio take the mean embedding of their simulated windows instead
        # (train/diagnose.py prototypes --save): the learned centre drifts for them (PIPELINE.md §9).
        sim = torch.load(sim_centres, map_location="cpu")
        assert model.centres == 1 and sim["tune_ids"] == ckpt["tune_ids"], "needs --one-centre and the same tunes"
        with torch.no_grad():
            model.weight[~sim["has_yue"]] = sim["per_tune"][~sim["has_yue"]].to(model.weight.dtype)
        # Real audio sits closer to simulated centres than to learned ones, so they would win
        # clips from tunes with learned centres; the offset evens the two groups out.
        model.offset[~sim["has_yue"]] = sim_offset
    if hub_reference:
        model.offset += hub_weight * hubness(model.eval(), ckpt["tune_ids"], hub_reference)
    return model.eval(), ckpt


@torch.no_grad()
def hubness(model: c.Classifier, tune_ids: list[int], reference: str) -> torch.Tensor:
    """Each tune's mean score against real recordings of other tunes (found_train.pt: training tunes
    only, so no eval tune), the clip's windows averaged as the finder does. Some tunes, waltzes most of
    all, sit close to everything; subtracting this evens them out (YouTube +3/-0, albums +2/-1, bands
    +1/-0 at weight 1: PIPELINE.md §9)."""
    index = {t: i for i, t in enumerate(tune_ids)}
    total, n = torch.zeros(len(tune_ids)), torch.zeros(len(tune_ids))
    for row in torch.load(reference, weights_only=False):
        x = row["windows"].float() / (255 if row["windows"].dtype == torch.uint8 else 1)  # height caches are uint8 (x255)
        x = pitchclass.keycanon(x)
        mean = torch.cat([model.cosines(embed(model, x[i:i + 64])) for i in range(0, len(x), 64)]).mean(0)
        other = torch.ones(len(tune_ids))
        if row["tune_id"] in index:
            other[index[row["tune_id"]]] = 0
        total += mean * other
        n += other
    return total / n


def test_signal() -> np.ndarray:
    """8 s of a reel-like line with partials 1-4 over a low drone; features.test.ts builds the same samples."""
    t = np.arange(c.FRAMES * pitchclass.HOP, dtype=np.float64) / pitchclass.SAMPLE_RATE
    notes = [62, 66, 69, 74, 73, 71, 69, 66, 67, 71, 74, 78, 76, 74, 73, 71]
    signal = 0.3 * np.sin(2 * math.pi * 98.0 * t)
    for i in range(40):
        start, freq = i * 0.2, 440.0 * 2 ** ((notes[i % len(notes)] - 69) / 12)
        local = t - start
        inside = (local >= 0) & (local < 0.2)
        envelope = np.minimum(1.0, local / 0.01) * np.exp(-3.0 * local)
        for h in range(1, 5):
            signal += np.where(inside, envelope * np.sin(2 * math.pi * freq * h * t) / h, 0.0)
    return (0.2 * signal).astype(np.float32)


def export(args) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    model, ckpt = load(args.checkpoint, args.one_centre, args.sim_centres, args.sim_offset, args.sim_parts, args.dim, args.hub_reference, args.hub_weight)
    torch.backends.mha.set_fastpath_enabled(False)  # the fused inference kernel has no ONNX form
    finder = Finder(model).eval()
    with torch.no_grad():
        torch.onnx.export(finder, (torch.rand(2, pitchclass.CHANNELS, c.FRAMES),), out / "model.onnx", input_names=["windows"], output_names=["cosines"],
                          dynamic_axes={"windows": {0: "batch"}, "cosines": {0: "batch"}}, opset_version=17, dynamo=False)
    (out / "tunes.json").write_text(json.dumps(ckpt["tune_ids"]))
    # Tunebook counts in the same column order: the finder's popularity prior (decode.ts).
    counts = c.popularity()
    (out / "popularity.json").write_text(json.dumps([counts.get(tune, 0) for tune in ckpt["tune_ids"]]))
    print(f"model.onnx: {(out / 'model.onnx').stat().st_size / 1e6:.0f} MB, {len(ckpt['tune_ids'])} tunes, step {ckpt['step']}")

    audio = torch.from_numpy(test_signal())[None]
    raw = pitchclass.features(pitchclass.semitones(audio)[:, :, :c.FRAMES], canon=False)
    shift = int(pitchclass.key_shift(raw)[0])
    canon = pitchclass.keycanon(raw)
    fixture = out / "features.fixture.json"  # for apps/web/src/lib/finder/features.test.ts
    fixture.write_text(json.dumps({"shift": shift, "features": [[round(v, 5) for v in row] for row in canon[0].tolist()]}))
    print(f"fixture: {fixture} (key shift {shift})")


def quantize(args) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    out = Path(args.out)
    # Matrix products only: onnxruntime has no integer Conv kernel, and the stem is a small share of the weights.
    quantize_dynamic(out / "model.onnx", out / "model.int8.onnx", weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
    print(f"model.int8.onnx: {(out / 'model.int8.onnx').stat().st_size / 1e6:.0f} MB")
    if args.head_bits == 4:
        import onnx
        from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer
        # The head is most of the file: put it alone at 4 bits (the MatMul with the largest weight;
        # the encoder stays as the int8 pass leaves it), then int8 the rest as above.
        model = onnx.load(out / "model.onnx")
        sizes = {i.name: int(np.prod(i.dims)) for i in model.graph.initializer}
        matmuls = [n for n in model.graph.node if n.op_type == "MatMul"]
        head = max(matmuls, key=lambda n: max(sizes.get(i, 0) for i in n.input))
        quantizer = MatMul4BitsQuantizer(model, block_size=32, is_symmetric=True, nodes_to_exclude=[n.name for n in matmuls if n is not head])
        quantizer.process()
        onnx.save(quantizer.model.model, out / "model.head4.onnx")
        quantize_dynamic(out / "model.head4.onnx", out / "model.int4head.onnx", weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
        (out / "model.head4.onnx").unlink()
        print(f"model.int4head.onnx: {(out / 'model.int4head.onnx').stat().st_size / 1e6:.0f} MB")


def check(args) -> None:
    """Top-1 of torch and each ONNX file on the eval clips, and how often a confident answer is right."""
    import onnxruntime as ort
    model, ckpt = load(args.checkpoint, args.one_centre, args.sim_centres, args.sim_offset, args.sim_parts, args.dim, args.hub_reference, args.hub_weight)
    index = {t: i for i, t in enumerate(ckpt["tune_ids"])}
    counts = c.popularity()  # the finder's prior, as decode.ts adds it
    prior = 0.006 * np.log(np.array([counts.get(t, 0) for t in ckpt["tune_ids"]]) + 1.0)
    clips = torch.load(args.clips, weights_only=False)
    sessions = {p.name: ort.InferenceSession(str(p)) for p in sorted(Path(args.out).glob("*.onnx"))}
    for name in ("youtube", "bands", "albums"):
        rows = [r for r in clips[name] if r["tune_id"] in index]
        hits = {k: 0 for k in ["torch", *sessions, "with prior"]}
        scored = []  # (margin between the top two tunes, top cosine, right?) from the first ONNX file
        for row in rows:
            x = pitchclass.keycanon(row["windows"].float())
            truth = index[row["tune_id"]]
            with torch.no_grad():
                hits["torch"] += int((model.cosines(embed(model, x)) - model.offset).mean(0).argmax()) == truth
            for i, (key, session) in enumerate(sessions.items()):
                mean = session.run(None, {"windows": x.numpy()})[0].mean(0)
                hits[key] += int(mean.argmax()) == truth
                if i == 0:
                    hits["with prior"] += int((mean + prior).argmax()) == truth
                    top = np.sort(mean)[-2:]
                    scored.append((top[1] - top[0], top[1], int(mean.argmax()) == truth))
        print(f"\n{name} ({len(rows)} clips): " + ", ".join(f"{k} {100 * v / len(rows):.1f}%" for k, v in hits.items()))
        for floor in (0.0, 0.01, 0.02, 0.03, 0.05, 0.08):
            kept = [right for margin, _, right in scored if margin >= floor]
            if kept:
                print(f"  margin >= {floor:.2f}: answers {100 * len(kept) / len(scored):5.1f}% of clips, right {100 * sum(kept) / len(kept):5.1f}%")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    e = sub.add_parser("export")
    e.add_argument("checkpoint")
    e.add_argument("out")
    q = sub.add_parser("quantize")
    q.add_argument("out")
    q.add_argument("--head-bits", type=int, choices=(8, 4), default=8)
    k = sub.add_parser("check")
    k.add_argument("checkpoint")
    k.add_argument("out")
    k.add_argument("--clips", default=c.CLIPS, help="eval clip features (classifier.py prepare)")
    for p in (e, k):
        p.add_argument("--one-centre", action="store_true", help="each tune's mean sub-centre instead of the best of its K")
        p.add_argument("--sim-centres", help="diagnose.py prototypes --save file: simulated centres for tunes without YuE2 audio")
        p.add_argument("--sim-offset", type=float, default=0.0, help="subtracted from the cosines of tunes with simulated centres")
        p.add_argument("--sim-parts", type=int, choices=(0, 1, 2, 4, 8, 16), default=0,
                       help="every tune takes this many simulated centres (diagnose.py prototypes per_eighth) instead of the hybrid head")
        p.add_argument("--dim", type=int, default=0, help="with --sim-parts: score in this many PCA dimensions of the centres (0: all)")
        p.add_argument("--hub-reference", help="real clips of training tunes (cache/classifier/found_train.pt): subtract each tune's mean score against them")
        p.add_argument("--hub-weight", type=float, default=1.0, help="how much of that hubness offset to subtract")
    args = parser.parse_args()
    {"export": export, "quantize": quantize, "check": check}[args.command](args)


if __name__ == "__main__":
    main()
