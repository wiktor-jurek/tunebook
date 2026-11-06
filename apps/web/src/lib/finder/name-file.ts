// A recording picked on the Sessions screen, from a phone's own recorder or a file, listened through as the live
// finder would have heard it at the session, so it arrives with its setlist like one recorded in the app.

import { SAMPLE_RATE } from "@/lib/finder/features";
import type { FinderRequest, FinderResponse } from "@/lib/finder/protocol";
import { MODEL_URL, TUNES_URL } from "@/lib/finder/use-listener";
import { NAMING_DELAY_MS, type SetlistEntry } from "@/lib/finder/use-recorder";
import type { FinderTune } from "@/lib/library";

export type NamingStep = { step: "reading" } | { step: "loading"; progress: number } | { step: "listening"; progress: number } | { step: "setlist" };

/** The file's audio, mixed to mono at the model's 16 kHz: decoding at that rate keeps a two-hour session in memory. */
async function decode(file: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let buffer: AudioBuffer;
  try { buffer = await context.decodeAudioData(await file.arrayBuffer()); } catch { throw new Error("This file could not be read as audio"); }
  // A copy: the worker is handed the array's memory, which the AudioBuffer's own data may not give up.
  if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0));
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / buffer.numberOfChannels;
  }
  return mono;
}

/** Each tune the finder names in `samples`, in a worker of its own so a listen in progress is not disturbed. */
function listen(samples: Float32Array, onStep: (step: NamingStep) => void): Promise<{ tuneId: number; atMs: number }[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const send = (message: FinderRequest, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
    const done = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<FinderResponse>) => {
      const message = event.data;
      if (message.type === "progress") onStep({ step: "loading", progress: message.total ? message.loaded / message.total : 0 });
      else if (message.type === "ready") { onStep({ step: "listening", progress: 0 }); send({ type: "file", samples, rate: SAMPLE_RATE }, [samples.buffer]); }
      else if (message.type === "fileProgress") onStep({ step: "listening", progress: message.done / message.total });
      else if (message.type === "fileDone") { done(); resolve(message.named); }
      else if (message.type === "error") { done(); reject(new Error(message.message)); }
    };
    worker.onerror = () => { done(); reject(new Error("The tune finder stopped")); };
    onStep({ step: "loading", progress: 0 });
    send({ type: "init", modelUrl: new URL(MODEL_URL, location.href).href, tunesUrl: new URL(TUNES_URL, location.href).href });
  });
}

/** The setting and title of each tune, 20 at a time as /api/finder takes them. */
async function lookUp(ids: number[]): Promise<Map<number, FinderTune>> {
  const found = new Map<number, FinderTune>();
  for (let i = 0; i < ids.length; i += 20) {
    const response = await fetch(`/api/finder?ids=${ids.slice(i, i + 20).join(",")}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not look up the tunes it heard");
    for (const tune of (await response.json()).tunes as FinderTune[]) found.set(tune.tuneId, tune);
  }
  return found;
}

/** The recording's length and setlist: each tune starts a little before it was named, and runs until the next. */
export async function nameTunesInFile(file: Blob, onStep: (step: NamingStep) => void): Promise<{ durationMs: number; tunes: SetlistEntry[] }> {
  onStep({ step: "reading" });
  const samples = await decode(file);
  const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
  const named = await listen(samples, onStep);
  onStep({ step: "setlist" });
  const tunes = await lookUp([...new Set(named.map((n) => n.tuneId))]);
  const entries = named.flatMap(({ tuneId, atMs }) => {
    const tune = tunes.get(tuneId);
    return tune ? [{ tuneId, settingId: tune.settingId, title: tune.title, startMs: Math.max(0, atMs - NAMING_DELAY_MS), endMs: 0 }] : [];
  });
  entries.forEach((entry, i) => { entry.endMs = entries[i + 1]?.startMs ?? durationMs; });
  return { durationMs, tunes: entries };
}
