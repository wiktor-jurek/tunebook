// Runs the Tune finder off the main thread: downloads and caches the model, turns each 8 s of
// microphone audio into features, scores every tune, and keeps the running verdict.
// Audio never leaves this worker.

import { Decoder } from "@/lib/finder/decode";
import { windowFeatures, FRAMES, SAMPLE_RATE, WINDOW_SAMPLES } from "@/lib/finder/features";
import { resample } from "@/lib/finder/resample";
import type { FinderRequest, FinderResponse } from "@/lib/finder/protocol";

// The parts of onnxruntime-web used here; it is loaded from the CDN at runtime, not bundled.
type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>> };
type Ort = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, options?: object): Promise<Session> };
};

const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
// Bump when a new model ships: the model is cached by URL, and older caches are deleted.
const CACHE = "tune-finder-v3";
// Below this RMS the room is quiet; nothing is scored.
const SILENCE = 0.003;

let ort: Ort | null = null;
let session: Session | null = null;
let tunes: number[] = [];
const decoder = new Decoder();
const post = (message: FinderResponse) => self.postMessage(message);

async function download(url: string, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  for (const name of await caches.keys().catch(() => [])) {
    if (name.startsWith("tune-finder-") && name !== CACHE) await caches.delete(name).catch(() => undefined);
  }
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url);
  const response = hit ?? await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download the model (${response.status})`);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.clone().body!.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.length; onProgress(loaded, total);
  }
  if (!hit) await cache?.put(url, response).catch(() => undefined);
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

async function init(modelUrl: string, tunesUrl: string) {
  ort = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${ORT_BASE}ort.wasm.min.mjs`) as Ort;
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which the app does not set
  const [model, ids] = await Promise.all([
    download(modelUrl, (loaded, total) => post({ type: "progress", loaded, total })),
    fetch(tunesUrl).then((r) => r.json() as Promise<number[]>),
  ]);
  session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  tunes = ids;
  post({ type: "ready", tunes: tunes.length });
}

async function score(samples: Float32Array, rate: number) {
  if (!ort || !session) return;
  const started = performance.now();
  const audio = resample(samples, rate, SAMPLE_RATE).subarray(-WINDOW_SAMPLES);
  let energy = 0;
  for (const s of audio) energy += s * s;
  if (Math.sqrt(energy / audio.length) < SILENCE) { post({ type: "quiet" }); return; }
  const input = new ort.Tensor("float32", windowFeatures(audio), [1, 12, FRAMES]);
  const output = await session.run({ windows: input });
  const verdict = decoder.push(output.cosines.data as Float32Array);
  post({ type: "verdict", status: verdict.status, margin: verdict.margin, ms: Math.round(performance.now() - started),
    candidates: verdict.candidates.map(({ index, cosine }) => ({ tuneId: tunes[index], cosine })) });
}

let busy = false;
self.onmessage = async (event: MessageEvent<FinderRequest>) => {
  const message = event.data;
  try {
    if (message.type === "init") await init(message.modelUrl, message.tunesUrl);
    else if (message.type === "reset") decoder.reset();
    else if (message.type === "audio" && !busy) {
      // Drop audio that arrives while a window is still being scored rather than queue it.
      busy = true;
      try { await score(message.samples, message.rate); } finally { busy = false; }
    }
  } catch (cause) {
    post({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
  }
};
