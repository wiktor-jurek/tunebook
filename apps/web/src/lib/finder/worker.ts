// Runs the Tune finder off the main thread: downloads and caches the model, turns each 8 s of
// microphone audio into features, scores every tune, and keeps the running verdict.
// Audio never leaves this worker.

import { Decoder, popularityPrior } from "@/lib/finder/decode";
import { windowFeatures, CHANNELS, FRAMES, SAMPLE_RATE, WINDOW_SAMPLES } from "@/lib/finder/features";
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
const CACHE = "tune-finder-v6";
// Below this RMS the room is quiet; nothing is scored.
const SILENCE = 0.003;

let ort: Ort | null = null;
let session: Session | null = null;
let tunes: number[] = [];
let channels = CHANNELS;
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
  const [model, ids, tunebooks] = await Promise.all([
    download(modelUrl, (loaded, total) => post({ type: "progress", loaded, total })),
    fetch(tunesUrl).then((r) => r.json() as Promise<number[]>),
    // Tunebook counts in tunes.json's column order, beside it (export_finder.py writes both).
    // Without the file the finder still works, only not weighted by popularity.
    fetch(new URL("popularity.json", tunesUrl)).then((r) => r.ok ? r.json() as Promise<number[]> : null).catch(() => null),
  ]);
  if (tunebooks?.length === ids.length) decoder.setPrior(popularityPrior(tunebooks));
  else console.warn("Tune finder: no popularity.json matching tunes.json; answers are not weighted by popularity");
  session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  channels = await inputChannels(ort, session);
  tunes = ids;
  post({ type: "ready", tunes: tunes.length });
}

/** 12 or 24: what the model takes. onnxruntime-web 1.20 does not expose input shapes, so try a silent window of each. */
async function inputChannels(ort: Ort, session: Session): Promise<number> {
  for (const n of [CHANNELS, CHANNELS === 24 ? 12 : 24]) {
    try {
      await session.run({ windows: new ort.Tensor("float32", new Float32Array(n * FRAMES), [1, n, FRAMES]) });
      return n;
    } catch { /* the other size */ }
  }
  throw new Error("The tune model takes neither 12 nor 24 channels");
}

/** The decoder's verdict on the last 8 s of `samples`, or null when the room is quiet and nothing is scored. */
async function judge(samples: Float32Array, rate: number) {
  if (!ort || !session) return null;
  const audio = resample(samples, rate, SAMPLE_RATE).subarray(-WINDOW_SAMPLES);
  let energy = 0;
  for (const s of audio) energy += s * s;
  if (Math.sqrt(energy / audio.length) < SILENCE) return null;
  const input = new ort.Tensor("float32", windowFeatures(audio, channels), [1, channels, FRAMES]);
  const output = await session.run({ windows: input });
  return decoder.push(output.cosines.data as Float32Array);
}

async function score(samples: Float32Array, rate: number) {
  if (!ort || !session) return;
  const started = performance.now();
  const verdict = await judge(samples, rate);
  if (!verdict) { post({ type: "quiet" }); return; }
  post({ type: "verdict", status: verdict.status, margin: verdict.margin, ms: Math.round(performance.now() - started),
    candidates: verdict.candidates.map(({ index, cosine }) => ({ tuneId: tunes[index], cosine })) });
}

/**
 * A whole recording, listened to as the live finder hears a session: from 3 s in, once a second, the last 8 s
 * (fewer at the start) go to the decoder, and each confident answer that differs from the one before is a new tune.
 */
async function scoreFile(samples: Float32Array, rate: number) {
  decoder.reset();
  const seconds = Math.floor(samples.length / rate), named: { tuneId: number; atMs: number }[] = [];
  for (let t = 3; t <= seconds; t++) {
    const verdict = await judge(samples.subarray(Math.max(0, (t - 8) * rate), t * rate), rate);
    const leader = verdict?.status === "match" ? tunes[verdict.candidates[0].index] : undefined;
    if (leader !== undefined && named[named.length - 1]?.tuneId !== leader) named.push({ tuneId: leader, atMs: t * 1000 });
    if (t % 10 === 0 || t === seconds) post({ type: "fileProgress", done: t, total: seconds });
  }
  decoder.reset();
  post({ type: "fileDone", named });
}

let busy = false;
self.onmessage = async (event: MessageEvent<FinderRequest>) => {
  const message = event.data;
  try {
    if (message.type === "init") await init(message.modelUrl, message.tunesUrl);
    else if (message.type === "reset") decoder.reset();
    else if (message.type === "file") await scoreFile(message.samples, message.rate);
    else if (message.type === "audio" && !busy) {
      // Drop audio that arrives while a window is still being scored rather than queue it.
      busy = true;
      try { await score(message.samples, message.rate); } finally { busy = false; }
    }
  } catch (cause) {
    post({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
  }
};
