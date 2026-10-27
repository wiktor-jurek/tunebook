"""Renders a JSONL of YuE2 requests with the model loaded once (runs on the GPU box).

Uses the yue2-music instrumental skill's own score compiler, validation and pinned
pipeline, so each clip is what `instrumental.py run --composer agent` would make, minus
the per-clip model load. Writes 16 kHz mono Opus and one index line per clip; reruns skip
clips already rendered. --shard takes one or more shards (0/8,2/8), worked through in
turn.

--batch N (default 8) decodes N clips' codec tokens together. Decoding one clip at a time
leaves the card waiting on memory: each token reads all 7 GB of weights, so N rows cost
little more than one. The weights and audio decoder stay on the card, where the stock
pipeline moves them to the CPU and back for every clip. Each row stops at --budget times
its score's length, since YuE2 sometimes plays on long past the score. --batch 1 is the
stock pipeline, one clip at a time (a 24 GB card holds two of those processes).

    cd /workspace/yue/skill && .venv/bin/python /workspace/batch.py /workspace/train.jsonl /workspace/train-out --shard 0/1
"""

import argparse
import hashlib
import json
import random
import subprocess
import sys
import time
from argparse import Namespace
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path.cwd() / "scripts"))

from compile_score import compile_events  # noqa: E402
from instrumental import lyric_tags, open_pipeline, validate_request, validate_score  # noqa: E402

CONDITIONS = ("no vocals", "no singing", "no choir", "no spoken words")
FRAMES_PER_SECOND = 25  # codec tokens: 48 kHz audio, 1920 samples a frame


def make_request(row: dict) -> dict:
    """The request `instrumental.py prepare` builds from events and a style."""
    text, _ = compile_events(row["events"])
    score = validate_score(text)
    style = row["style"].strip().rstrip(".,")
    for condition in CONDITIONS:
        if condition not in style.lower():
            style += ", " + condition
    request = dict(id=row["name"], style=style + ".", lyrics=lyric_tags(text), abc=text,
                   cot="full" if score.voices["Vocal"].chords else "melody", seed=row["seed"])
    validate_request(request)
    return request


def score_seconds(row: dict) -> float:
    """How long the score lasts: note onsets and lengths are in beats."""
    onset, length, _ = row["events"]["notes"][-1]
    return float((Fraction(onset) + Fraction(length)) * 60 / row["events"]["bpm"])


def save(audio, path: Path) -> None:
    """48 kHz stereo float → 16 kHz mono Opus for training, plus a full-quality AAC copy for the web."""
    raw = audio.astype("float32")
    raw = raw.T if raw.shape[0] == 2 else raw
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", str(raw.shape[1] if raw.ndim == 2 else 1),
                    "-i", "pipe:", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "48k", str(path),
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(path.with_suffix(".m4a"))],
                   input=raw.tobytes(), check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("requests", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--shard", default="0/1")
    parser.add_argument("--batch", type=int, default=8, help="clips decoded together; 1 is the stock pipeline")
    parser.add_argument("--budget", type=float, default=2.0, help="stop a clip at this many times its score's length, plus 10 s")
    parser.add_argument("--ode-steps", type=int, default=32, help="acoustic solver steps (the release uses 32)")
    parser.add_argument("--limit", type=int, help="render only this many per shard (a benchmark)")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    import torch

    with open_pipeline(Namespace(models_root=Path("models"), offline=True, device="cuda:0")) as pipe:
        renderer = Batched(pipe, args, torch) if args.batch > 1 else None
        for shard in args.shard.split(","):
            index, count = (int(x) for x in shard.split("/"))
            done = {row["name"] for path in args.out.glob("index-*.jsonl") for row in map(json.loads, path.open()) if row["status"] == "ok"}
            rows = [json.loads(line) for i, line in enumerate(args.requests.open()) if i % count == index]
            rows = [row for row in rows if row["name"] not in done][: args.limit]
            print(f"shard {shard}: {len(rows)} to render", flush=True)
            with (args.out / f"index-{index}.jsonl").open("a") as handle:
                def log(entry: dict) -> None:
                    handle.write(json.dumps(entry) + "\n")
                    handle.flush()
                    print(f"{entry['name']} {entry['status']} {entry['elapsed']}s", flush=True)

                if renderer:
                    renderer.run(rows, args.out, log)
                else:
                    for row in rows:
                        log(render_one(pipe, row, args.out, torch))


def events_hash(events: dict) -> str:
    """Fingerprint of the notes a clip was made from, so a clip from rebuilt notes can be told apart."""
    return hashlib.sha1(json.dumps(events, sort_keys=True).encode()).hexdigest()[:12]


def entry_for(row: dict) -> dict:
    return {"name": row["name"], "tune_id": row["tune_id"], "setting_id": row["setting_id"], "style": row["style"],
            "events": events_hash(row["events"])}


def render_one(pipe, row: dict, out: Path, torch) -> dict:
    start = time.time()
    entry = entry_for(row)
    for attempt in range(5):
        try:
            song = pipe(**make_request(row))
            save(song.audio, out / f"{row['name']}.ogg")
            truncated = song.truncated.values() if isinstance(song.truncated, dict) else [song.truncated]
            entry.update(status="ok", seconds=round(max(song.audio.shape) / 48000, 2), truncated=any(truncated))
            break
        except torch.cuda.OutOfMemoryError as error:  # the other process on the card peaked; wait and retry
            torch.cuda.empty_cache()
            time.sleep(5 + 10 * random.random())
            entry.update(status="failed", error=f"OutOfMemoryError after {attempt + 1} tries: {error}"[:300])
        except Exception as error:  # one bad score must not stop the batch
            entry.update(status="failed", error=f"{type(error).__name__}: {error}"[:300])
            break
    entry["elapsed"] = round(time.time() - start, 1)
    return entry


class Batched:
    """The pipeline's three stages with the codec tokens of several clips decoded together.

    Each clip keeps the stock request, prefix, sampling settings, acoustic solver and decoder;
    only the random draws differ, as one generator serves the whole batch."""

    def __init__(self, pipe, args, torch):
        from yue2.modeling_vae import YuE2VAE

        self.pipe, self.args, self.torch = pipe, args, torch
        self.model = pipe._load_model()
        self.vae = YuE2VAE.from_pretrained(pipe.vae_dir, decoder_only=True, device=pipe.device, local_files_only=True)
        self.sampling = pipe.generation_config.semantic
        self.encoder = ThreadPoolExecutor(4)  # ffmpeg runs beside the next batch

    def run(self, rows: list[dict], out: Path, log) -> None:
        # Clips of a similar length share a batch, so few rows sit finished while others play on.
        rows = sorted(rows, key=score_seconds)
        pending = []
        for at in range(0, len(rows), self.args.batch):
            for entry, future in pending:
                log(self.finish(entry, future))
            pending = self.render(rows[at:at + self.args.batch], out)
        for entry, future in pending:
            log(self.finish(entry, future))

    @staticmethod
    def finish(entry: dict, future) -> dict:
        if future is not None:
            try:
                future.result()
            except Exception as error:
                entry.update(status="failed", error=f"encode: {type(error).__name__}: {error}"[:300])
        return entry

    def render(self, rows: list[dict], out: Path) -> list:
        from yue2.nar import synthesize
        from yue2.protocol import token_prefixes

        torch = self.torch
        start = time.time()
        entries, jobs = [], []
        for slot, row in enumerate(rows):
            entry = entry_for(row)
            try:
                request = self.pipe._request(**make_request(row))
                if len(self.pipe.tokenizer.encode(request.abc)) > 4096:
                    raise ValueError("ABC exceeds the 4096-token planning budget")
                if request.guidance != 1:
                    raise ValueError("batched decoding has no classifier-free guidance branch")
                budget = min(self.sampling.max_tokens, int((self.args.budget * score_seconds(row) + 10) * FRAMES_PER_SECOND))
                jobs.append((slot, row, entry, token_prefixes(request, self.pipe.tokenizer), max(budget, self.sampling.min_tokens + 1)))
            except Exception as error:
                entry.update(status="failed", error=f"{type(error).__name__}: {error}"[:300], elapsed=0.0)
            entries.append((entry, None))
        if not jobs:
            return entries
        try:
            decoded = self.decode_tokens([prefix for *_, prefix, _ in jobs], [budget for *_, budget in jobs], jobs[0][1]["seed"])
        except torch.cuda.OutOfMemoryError:
            if len(rows) == 1:
                raise
            torch.cuda.empty_cache()
            half = len(rows) // 2
            print(f"out of memory decoding {len(rows)} together; splitting", flush=True)
            return self.render(rows[:half], out) + self.render(rows[half:], out)
        ar_seconds = (time.time() - start) / len(jobs)
        for (slot, row, entry, prefix, _), (codec, truncated) in zip(jobs, decoded):
            clip_start = time.time()
            try:
                latents = synthesize(self.model, prefix, codec, row["seed"], steps=self.args.ode_steps)
                nar_seconds = time.time() - clip_start
                z = latents.float().T.unsqueeze(0)
                with torch.inference_mode():
                    audio = self.vae.decode_tiled(z, core_frames=self.pipe.vae_core_frames, halo_frames=16, output_device="cpu")
                if not torch.isfinite(audio).all():
                    raise ValueError("VAE produced non-finite audio")
                audio = audio[0].float().clamp(-1, 1).T.contiguous().numpy()
                entry.update(status="ok", seconds=round(len(audio) / 48000, 2), truncated=truncated,
                             timing={"ar": round(ar_seconds, 1), "nar": round(nar_seconds, 1),
                                     "vae": round(time.time() - clip_start - nar_seconds, 1)})
                future = self.encoder.submit(save, audio, out / f"{row['name']}.ogg")
            except Exception as error:  # one bad clip must not stop the batch
                entry.update(status="failed", error=f"{type(error).__name__}: {error}"[:300])
                future = None
            entry["elapsed"] = round(ar_seconds + time.time() - clip_start, 1)
            entries[slot] = (entry, future)
        return entries

    def decode_tokens(self, prefixes: list[list[int]], budgets: list[int], seed: int) -> list[tuple[list[int], bool]]:
        """Codec tokens for each prefix, sampled as yue2.sampling does for one request:
        codec tokens only, no end before min_tokens, a repetition penalty over the last
        penalty_window tokens, then temperature, top-k and top-p."""
        from yue2.protocol import CODEC_OFFSET, CODEC_SIZE, MUSIC_END

        torch, s = self.torch, self.sampling
        if s.temperature <= 0:
            raise ValueError("batched decoding samples; greedy decoding is not supported")
        device = self.pipe.device
        longest = max(budgets)
        graph = RowsAR(self.model, prefixes, longest, capture=device.type == "cuda")
        try:
            allowed = torch.full((self.model.config.vocab_size,), float("-inf"), device=device)
            allowed[CODEC_OFFSET:CODEC_OFFSET + CODEC_SIZE] = 0
            allowed[MUSIC_END] = 0
            generator = torch.Generator(device=device).manual_seed(seed)
            history = torch.zeros((len(prefixes), longest), dtype=torch.long, device=device)
            limit = torch.tensor(budgets, device=device)
            logits = graph.prefill()
            for step in range(longest):
                probabilities, indices = codec_choices(logits, history[:, max(0, step - s.penalty_window):step], step, s, allowed)
                pick = torch.multinomial(probabilities, 1, generator=generator)
                token = indices.gather(-1, pick)[:, 0]
                history[:, step] = token
                if step % 32 == 31 or step + 1 == longest:
                    ended = (history[:, :step + 1] == MUSIC_END).any(1) | (limit <= step + 1)
                    if bool(ended.all()):
                        break
                if step + 1 < longest:
                    logits = graph.step_rows(token)
            rows = []
            for row, budget in zip(history.tolist(), budgets):
                row = row[:budget]
                end = row.index(MUSIC_END) if MUSIC_END in row else None
                rows.append(([t - CODEC_OFFSET for t in row[:end]], end is None))
            return rows
        finally:
            graph.close()


def codec_choices(logits, recent, step: int, s, allowed):
    """Each row's candidate tokens and their probabilities, as yue2.sampling.distribution
    gives them for one request: codec tokens only, no end before min_tokens, a repetition
    penalty over `recent`, temperature, top-k, then top-p within the top-k."""
    import torch
    from yue2.protocol import MUSIC_END

    scores = logits.float() + allowed
    if step < s.min_tokens:
        scores[:, MUSIC_END] = float("-inf")
    if s.repetition_penalty != 1 and recent.shape[1]:
        alpha = s.repetition_penalty ** torch.zeros_like(scores).scatter_add_(-1, recent, torch.ones_like(recent, dtype=scores.dtype))
        scores = torch.where(scores < 0, scores * alpha, scores / alpha)
    # Top-k keeps every token tied with the k-th (bfloat16 logits tie often): take twice
    # as many and drop those below the k-th value, which spares a sync to count the ties.
    values, indices = (scores / s.temperature).topk(min(2 * s.top_k, scores.shape[-1]))
    values = values.masked_fill(values < values[:, s.top_k - 1:s.top_k], float("-inf"))
    probabilities = values.softmax(-1)
    removed = probabilities.cumsum(-1) - probabilities > s.top_p
    removed[:, 0] = False
    return values.masked_fill(removed, float("-inf")).softmax(-1), indices


def RowsAR(model, prefixes, max_tokens, capture=True):
    """yue2's CUDA-graph decoder (cuda_graph.GraphAR) for any number of independent rows.

    Its decode step already keeps per-row positions, KV slots and variable-length flash
    attention; the class only refuses more than two rows (one request or a CFG pair) and
    feeds every row the same token. This builds it for two rows, re-sizes the per-row
    state for all of them, and steps each row with its own token."""
    from yue2.cuda_graph import GraphAR

    class Rows(GraphAR):
        def step_rows(self, tokens):
            self.tokens.copy_(tokens.view(-1, 1))
            self.steps += 1
            if self.graph is None:  # capture=False: the eager path, for checks on the CPU
                return self._decode()
            self.graph.replay()
            return self.output

    import torch

    config = model.config
    if any(len(prefix) + max_tokens > config.max_position_embeddings for prefix in prefixes):
        raise ValueError("Prefix plus generation budget exceeds model context")
    graph = Rows(model, [prefixes[0], prefixes[0]], 1, capture=capture)
    device, dtype = graph.device, graph.dtype
    graph.prefixes = [[int(token) for token in prefix] for prefix in prefixes]
    graph.max_tokens, graph.branches = int(max_tokens), len(prefixes)
    graph.capacity = max(map(len, prefixes)) + graph.max_tokens
    shape = (graph.branches, graph.capacity, config.num_key_value_heads, config.head_dim)
    graph.keys = [torch.zeros(shape, device=device, dtype=dtype) for _ in model.model.layers]
    graph.values = [torch.zeros(shape, device=device, dtype=dtype) for _ in model.model.layers]
    graph.positions = torch.tensor([len(prefix) for prefix in prefixes], dtype=torch.long, device=device)
    graph.initial_positions = graph.positions.clone()
    graph.key_positions = torch.arange(graph.capacity, dtype=torch.long, device=device)
    graph.cu_q = torch.arange(graph.branches + 1, dtype=torch.int32, device=device)
    graph.cu_k = graph.cu_q * graph.capacity
    graph.tokens = torch.tensor([[prefix[-1]] for prefix in prefixes], dtype=torch.long, device=device)
    return graph


if __name__ == "__main__":
    main()
