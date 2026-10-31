"use client";

import { trackEvent } from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMotionValue } from "motion/react";
import type { FinderTune } from "@/lib/library";
import type { FinderCandidate, FinderRequest, FinderResponse } from "@/lib/finder/protocol";
import { makeTunebook } from "@/lib/finder/make-book";

const MODEL_URL = process.env.NEXT_PUBLIC_FINDER_MODEL_URL || "/finder/model.onnx";
const TUNES_URL = process.env.NEXT_PUBLIC_FINDER_TUNES_URL || "/finder/tunes.json";
const BUFFER_SECONDS = 8;
const HOP_MS = 1000;
// Tunes heard tonight survive a reload in the pub, until the tab is closed.
const HEARD_KEY = "tunebook-heard";
// Collects microphone samples in the audio thread and hands them over in blocks.
const TAP = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(2048); this.filled = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) for (let i = 0; i < channel.length; i++) {
      this.block[this.filled++] = channel[i];
      if (this.filled === this.block.length) { this.port.postMessage(this.block.slice(0)); this.filled = 0; }
    }
    return true;
  }
}
registerProcessor("tune-finder-tap", Tap);`;

export type ListenPhase = "idle" | "starting" | "loading" | "listening" | "denied" | "error";
export type ListenStatus = "quiet" | "listening" | "unsure" | "match";
export type Heard = { tune: FinderTune; at: number };

// Kept in sessionStorage (or memory, where storage is blocked) and read as an external store, so the server renders none.
let heardMemory = "[]";
const heardListeners = new Set<() => void>();
const heardStore = {
  subscribe(listener: () => void) { heardListeners.add(listener); return () => { heardListeners.delete(listener); }; },
  snapshot() { try { return sessionStorage.getItem(HEARD_KEY) ?? "[]"; } catch { return heardMemory; } },
  update(change: (current: Heard[]) => Heard[]) {
    const current = JSON.parse(heardStore.snapshot()) as Heard[], next = change(current);
    if (next === current) return;
    heardMemory = JSON.stringify(next);
    try { sessionStorage.setItem(HEARD_KEY, heardMemory); } catch { /* private browsing */ }
    heardListeners.forEach((listener) => listener());
  },
};

/** The tune finder's microphone, model and answers, shared by every screen that listens. */
export function useTuneListener() {
  const [phase, setPhase] = useState<ListenPhase>("idle");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [status, setStatus] = useState<ListenStatus>("listening");
  const [candidates, setCandidates] = useState<FinderCandidate[]>([]);
  // How far the leader is ahead of the next guess; the finder draws it as an arc filling around the button.
  const [margin, setMargin] = useState(0);
  const [tunes, setTunes] = useState<Record<number, FinderTune>>({});
  const heardRaw = useSyncExternalStore(heardStore.subscribe, heardStore.snapshot, () => "[]");
  const heard = useMemo(() => JSON.parse(heardRaw) as Heard[], [heardRaw]);
  // The input level changes with every block of audio; as a motion value it moves the halo without re-rendering anything.
  const level = useMotionValue(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  // Whether the phone agreed to keep the screen on while listening; if not, the screen says so.
  const [awake, setAwake] = useState(false);
  const audio = useRef<{ context: AudioContext; stream: MediaStream; timer: number; wakeLock: WakeLockSentinel | null } | null>(null);
  const worker = useRef<Worker | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const started = useRef(0);
  const lookups = useRef(new Set<number>());

  const send = (message: FinderRequest, transfer: Transferable[] = []) => worker.current?.postMessage(message, transfer);

  const lookup = useCallback(async (ids: number[]) => {
    const missing = ids.filter((id) => !lookups.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => lookups.current.add(id));
    try {
      const response = await fetch(`/api/finder?ids=${missing.join(",")}`, { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setTunes((current) => ({ ...current, ...Object.fromEntries((result.tunes as FinderTune[]).map((tune) => [tune.tuneId, tune])) }));
    } catch { missing.forEach((id) => lookups.current.delete(id)); }
  }, []);

  // One worker for the page's lifetime: the model stays loaded between listens.
  const loadModel = useCallback(() => {
    if (ready.current) return ready.current;
    ready.current = new Promise<void>((resolve, reject) => {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      w.onmessage = (event: MessageEvent<FinderResponse>) => {
        const message = event.data;
        if (message.type === "progress") setProgress({ loaded: message.loaded, total: message.total });
        else if (message.type === "ready") resolve();
        else if (message.type === "quiet") setStatus("quiet");
        else if (message.type === "verdict") {
          setStatus(message.status); setCandidates(message.candidates); setMargin(message.margin);
          void lookup(message.candidates.slice(0, 5).map((c) => c.tuneId));
        } else if (message.type === "error") { reject(new Error(message.message)); setError(message.message); setPhase("error"); }
      };
      w.postMessage({ type: "init", modelUrl: new URL(MODEL_URL, location.href).href, tunesUrl: new URL(TUNES_URL, location.href).href } satisfies FinderRequest);
    });
    ready.current.catch(() => { ready.current = null; worker.current?.terminate(); worker.current = null; });
    return ready.current;
  }, [lookup]);

  const stop = useCallback(() => {
    if (!audio.current) return;
    window.clearInterval(audio.current.timer);
    audio.current.stream.getTracks().forEach((track) => track.stop());
    void audio.current.context.close();
    void audio.current.wakeLock?.release().catch(() => undefined);
    audio.current = null;
    setPhase("idle"); level.set(0); setAwake(false);
  }, [level]);

  const start = useCallback(async () => {
    setError(""); setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      trackEvent("tune_finder_started", { outcome: "error", reason: "unsupported" });
      setError("This browser cannot listen through the microphone."); setPhase("error"); return;
    }
    let stream: MediaStream;
    try {
      // Voice processing is made for speech and smears music, so it is turned off.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    } catch {
      trackEvent("tune_finder_started", { outcome: "error", reason: "denied" });
      setPhase("denied"); return;
    }
    setPhase("loading");
    try { await loadModel(); } catch (cause) {
      stream.getTracks().forEach((track) => track.stop());
      trackEvent("tune_finder_started", { outcome: "error", reason: "model" });
      setError(cause instanceof Error ? cause.message : "Could not load the tune model"); setPhase("error"); return;
    }
    const context = new AudioContext();
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: "application/javascript" })));
    const source = context.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(context, "tune-finder-tap");
    const ring = new Float32Array(Math.round(context.sampleRate * BUFFER_SECONDS));
    let written = 0;
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const block = event.data;
      ring.copyWithin(0, block.length); ring.set(block, ring.length - block.length);
      written += block.length;
      let energy = 0;
      for (const s of block) energy += s * s;
      level.set(Math.min(1, Math.sqrt(energy / block.length) * 8));
    };
    source.connect(tap);
    send({ type: "reset" });
    started.current = Date.now();
    setStatus("listening"); setCandidates([]); setMargin(0);
    const timer = window.setInterval(() => {
      // Score once there are at least 3 s; the worker zero-pads the rest of the window.
      if (written < context.sampleRate * 3) return;
      const samples = ring.slice(Math.max(0, ring.length - written));
      send({ type: "audio", samples, rate: context.sampleRate }, [samples.buffer]);
    }, HOP_MS);
    // A phone held up to the music must not dim and lock while it listens.
    const wakeLock = await navigator.wakeLock?.request("screen").catch(() => null) ?? null;
    audio.current = { context, stream, timer, wakeLock };
    setAwake(!!wakeLock);
    trackEvent("tune_finder_started", { outcome: "success" });
    setPhase("listening");
  }, [level, loadModel]);

  /** Forgets the current answer and listens for a new tune. */
  const restart = useCallback(() => { send({ type: "reset" }); setCandidates([]); setMargin(0); setStatus("listening"); started.current = Date.now(); }, []);

  useEffect(() => () => { stop(); worker.current?.terminate(); }, [stop]);

  // A confident answer that differs from the last one heard joins the list: a set moving on.
  const leader = candidates[0] ? tunes[candidates[0].tuneId] ?? null : null;
  useEffect(() => {
    if (status !== "match" || !leader) return;
    heardStore.update((current) => {
      if (current[0]?.tune.tuneId === leader.tuneId) return current;
      trackEvent("tune_finder_matched", { tune: leader.title, seconds: Math.floor((Date.now() - started.current) / 1000) });
      return [{ tune: leader, at: Date.now() }, ...current];
    });
  }, [status, leader]);

  /** Saves a heard tune to the library and returns its saved id, or null if that failed. */
  const save = useCallback(async (tune: FinderTune): Promise<string | null> => {
    setSaving(tune.tuneId);
    try {
      const response = await fetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settingId: tune.settingId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the tune");
      trackEvent("tune_saved", { outcome: "success", tune: tune.title });
      const saved = { ...tune, savedId: result.tuneId as string };
      setTunes((current) => ({ ...current, [tune.tuneId]: saved }));
      heardStore.update((current) => current.map((h) => h.tune.tuneId === tune.tuneId ? { ...h, tune: saved } : h));
      return saved.savedId;
    } catch { trackEvent("tune_saved", { outcome: "error", tune: tune.title }); return null; }
    finally { setSaving(null); }
  }, []);

  /** One tap in the pub: save the tune and mark it Want to learn, with no tunebook to choose. A level already set stays. */
  const learnLater = useCallback(async (tune: FinderTune) => {
    const savedId = tune.savedId ?? await save(tune);
    if (!savedId) return;
    if (tune.level !== "unlearned") return;
    setSaving(tune.tuneId);
    try {
      const response = await fetch(`/api/tunes/${savedId}/practice`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "level", level: "wanted" }) });
      if (!response.ok) throw new Error();
      trackEvent("tune_practice_updated", { outcome: "success", source: "level" });
      const wanted = { ...tune, savedId, level: "wanted" as const };
      setTunes((current) => ({ ...current, [tune.tuneId]: wanted }));
      heardStore.update((current) => current.map((h) => h.tune.tuneId === tune.tuneId ? { ...h, tune: wanted } : h));
    } catch { trackEvent("tune_practice_updated", { outcome: "error", source: "level" }); }
    finally { setSaving(null); }
  }, [save]);

  const alternatives = candidates.slice(1, 5).flatMap((c) => tunes[c.tuneId] ? [tunes[c.tuneId]] : []);
  const clearHeard = useCallback(() => heardStore.update(() => []), []);

  /** Puts tonight's heard tunes, in the order they were played, into a new tunebook and returns its id. */
  const makeBook = useCallback(async (name: string) => {
    const played = [...heard].reverse().filter((h, i, all) => all.findIndex((other) => other.tune.tuneId === h.tune.tuneId) === i);
    try {
      const { bookId, tunes } = await makeTunebook(name, played.map((h) => h.tune));
      trackEvent("session_book_made", { outcome: "success", tune_count: tunes });
      return bookId;
    } catch (cause) { trackEvent("session_book_made", { outcome: "error", tune_count: played.length }); throw cause; }
  }, [heard]);
  // 0 to 1; a margin of 0.08 is as sure as the finder gets (the old confidence bar used the same scale).
  const certainty = Math.min(1, margin / 0.08);
  return { phase, progress, status, certainty, awake, tunes, leader, alternatives, heard, level, error, saving, start, stop, restart, save, learnLater, clearHeard, makeBook, stream: () => audio.current?.stream ?? null };
}
