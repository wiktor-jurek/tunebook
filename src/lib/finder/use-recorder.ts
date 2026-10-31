"use client";

import { trackEvent } from "@/lib/analytics";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FinderTune } from "@/lib/library";

// A whole session recorded on the phone. Each 10 s chunk goes to IndexedDB as it arrives, so a crash,
// a reload or a dead battery loses at most a few seconds; the recording uploads when it stops.
const DB = "tunebook-recordings";
const CHUNK_MS = 10_000;
// The finder names a tune a few seconds after it starts; its setlist entry starts this much earlier.
const NAMING_DELAY_MS = 8_000;
const TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];

// A rejected entry is one the person swiped away as wrong; it uploads anyway, as a labelled mistake.
export type SetlistEntry = { tuneId: number; settingId: number; title: string; startMs: number; endMs: number; rejected?: boolean };
export type LocalRecording = { id: string; name: string; mime: string; recordedAt: string; durationMs: number; tunes: SetlistEntry[]; finished: boolean };
export type UploadState = { id: string; status: "uploading" | "failed"; error?: string };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["id", "seq"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = work(tx);
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
const saveMeta = (recording: LocalRecording) => run(["recordings"], "readwrite", (tx) => { tx.objectStore("recordings").put(recording); });
const allMeta = async () => (await run<LocalRecording[]>(["recordings"], "readonly", (tx) => tx.objectStore("recordings").getAll())) ?? [];
const chunksOf = async (id: string) => (await run<{ data: Blob }[]>(["chunks"], "readonly", (tx) => tx.objectStore("chunks").getAll(IDBKeyRange.bound([id, 0], [id, Infinity])))) ?? [];
const forget = (id: string) => run(["recordings", "chunks"], "readwrite", (tx) => {
  tx.objectStore("recordings").delete(id);
  tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
});

/** Uploads a finished local recording: create the row, PUT the audio to the bucket, then store the setlist. */
async function upload(recording: LocalRecording) {
  const chunks = await chunksOf(recording.id);
  if (!chunks.length) throw new Error("Nothing was recorded");
  const audio = new Blob(chunks.map((chunk) => chunk.data), { type: recording.mime });
  const created = await fetch("/api/recordings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: recording.name, mime: recording.mime, recordedAt: recording.recordedAt }) });
  const { id, uploadUrl, error } = await created.json();
  if (!created.ok) throw new Error(error || "Could not start the upload");
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": recording.mime.split(";")[0] }, body: audio });
  if (!put.ok) throw new Error("The upload did not finish");
  const finished = await fetch(`/api/recordings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "finish", durationMs: Math.round(recording.durationMs), tunes: recording.tunes.map(({ tuneId, settingId, startMs, endMs, rejected }) => ({ tuneId, settingId, startMs: Math.round(startMs), endMs: Math.round(endMs), rejected: !!rejected })) }) });
  if (!finished.ok) throw new Error((await finished.json()).error || "Could not save the setlist");
  await forget(recording.id);
  return id as string;
}

/** `enabled` is false on screens that never record, so they do not touch IndexedDB. */
export function useSessionRecorder(enabled: boolean) {
  const [active, setActive] = useState<LocalRecording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<LocalRecording[]>([]);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const recorder = useRef<{ media: MediaRecorder; meta: LocalRecording; started: number; seq: number; timer: number; writing: Promise<unknown> } | null>(null);
  // Read like an external store so the server (which cannot record) and the first browser render agree.
  const capable = useSyncExternalStore(() => () => undefined, () => typeof MediaRecorder !== "undefined" && typeof indexedDB !== "undefined", () => false);
  const supported = enabled && capable;

  const refresh = useCallback(async () => { if (supported) setPending((await allMeta().catch(() => [])).filter((r) => r.finished)); }, [supported]);
  // Recordings cut off by a reload or a crash are closed off at their last chunk and offered for upload.
  useEffect(() => {
    if (!supported) return;
    void allMeta().then(async (all) => {
      for (const r of all.filter((r) => !r.finished)) await saveMeta({ ...r, finished: true, tunes: r.tunes.map((t) => ({ ...t, endMs: t.endMs || r.durationMs })) });
      await refresh();
    }).catch(() => undefined);
  }, [supported, refresh]);

  const send = useCallback(async (recording: LocalRecording) => {
    setUploads((current) => ({ ...current, [recording.id]: { id: recording.id, status: "uploading" } }));
    try {
      await upload(recording);
      trackEvent("session_recording_uploaded", { outcome: "success", tune_count: recording.tunes.length });
      setUploads((current) => { const next = { ...current }; delete next[recording.id]; return next; });
    } catch (cause) {
      trackEvent("session_recording_uploaded", { outcome: "error", tune_count: recording.tunes.length });
      setUploads((current) => ({ ...current, [recording.id]: { id: recording.id, status: "failed", error: cause instanceof Error ? cause.message : "Upload failed" } }));
    }
    await refresh();
  }, [refresh]);

  const start = useCallback(async (stream: MediaStream, name: string) => {
    const mime = TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
    const media = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: 48_000 });
    const meta: LocalRecording = { id: crypto.randomUUID(), name, mime: media.mimeType || mime || "audio/webm", recordedAt: new Date().toISOString(), durationMs: 0, tunes: [], finished: false };
    await saveMeta(meta);
    const state = { media, meta, started: performance.now(), seq: 0, timer: 0, writing: Promise.resolve() as Promise<unknown> };
    media.ondataavailable = (event) => {
      if (!event.data.size) return;
      const seq = state.seq++;
      state.meta.durationMs = performance.now() - state.started;
      // Writes are chained, so stopping can wait for the last one.
      state.writing = state.writing.then(() => run(["chunks", "recordings"], "readwrite", (tx) => { tx.objectStore("chunks").put({ id: meta.id, seq, data: event.data }); tx.objectStore("recordings").put(state.meta); })).catch(() => undefined);
    };
    media.start(CHUNK_MS);
    state.timer = window.setInterval(() => setElapsed(performance.now() - state.started), 1000);
    recorder.current = state;
    setActive(meta); setElapsed(0);
    trackEvent("session_recording_started", {});
  }, []);

  /** Adds a newly named tune to the setlist, ending the one before it. */
  const mark = useCallback((tune: FinderTune) => {
    const state = recorder.current;
    if (!state) return;
    const now = performance.now() - state.started, startMs = Math.max(0, now - NAMING_DELAY_MS);
    const tunes = state.meta.tunes, last = tunes[tunes.length - 1];
    if (last?.tuneId === tune.tuneId) return;
    if (last) last.endMs = startMs;
    tunes.push({ tuneId: tune.tuneId, settingId: tune.settingId, title: tune.title, startMs, endMs: 0 });
    setActive({ ...state.meta });
  }, []);

  /** Marks a tune's latest setlist entry as wrong. It stays in the setlist, hidden, so the mistake can teach the finder. */
  const reject = useCallback((tuneId: number) => {
    const state = recorder.current;
    if (!state) return;
    const entry = state.meta.tunes.findLast((t) => t.tuneId === tuneId && !t.rejected);
    if (!entry) return;
    entry.rejected = true;
    void saveMeta(state.meta).catch(() => undefined);
    setActive({ ...state.meta });
    trackEvent("session_tune_rejected", { tune: entry.title });
  }, []);

  const stop = useCallback(async () => {
    const state = recorder.current;
    if (!state) return;
    recorder.current = null;
    window.clearInterval(state.timer);
    // The last chunk arrives with the stop event.
    await new Promise<void>((resolve) => { state.media.addEventListener("stop", () => resolve(), { once: true }); state.media.stop(); });
    const durationMs = performance.now() - state.started;
    const meta: LocalRecording = { ...state.meta, durationMs, finished: true, tunes: state.meta.tunes.map((t) => ({ ...t, endMs: t.endMs || durationMs })) };
    await state.writing;
    await saveMeta(meta);
    setActive(null);
    await send(meta);
  }, [send]);

  const discard = useCallback(async (id: string) => { await forget(id); await refresh(); }, [refresh]);

  return { supported, active, elapsed, pending, uploads, start, mark, reject, stop, retry: send, discard };
}
