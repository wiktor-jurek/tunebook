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
// An upload goes through preparing, sending the audio (with how much is sent, 0 to 1), saving the setlist, then done;
// done lingers a moment, holding the recording, so the screen can show it arrive.
export type UploadState = { id: string; status: "preparing" | "sending" | "saving" | "done" | "failed"; progress: number; recording: LocalRecording; error?: string };

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

/** PUTs the audio straight to the bucket, reporting how much has gone. Fetch cannot report upload progress; this can. */
function put(url: string, type: string, body: Blob, onProgress: (sent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", type);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("The upload did not finish")));
    request.onerror = () => reject(new Error("The connection dropped during the upload"));
    request.send(body);
  });
}

/** Uploads a finished local recording: create the row, PUT the audio to the bucket, then store the setlist. */
async function upload(recording: LocalRecording, step: (status: UploadState["status"], progress?: number) => void) {
  const chunks = await chunksOf(recording.id);
  if (!chunks.length) throw new Error("Nothing was recorded");
  const audio = new Blob(chunks.map((chunk) => chunk.data), { type: recording.mime });
  const created = await fetch("/api/recordings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: recording.name, mime: recording.mime, recordedAt: recording.recordedAt }) });
  const { id, uploadUrl, error } = await created.json();
  if (!created.ok) throw new Error(error || "Could not start the upload");
  step("sending", 0);
  await put(uploadUrl, recording.mime.split(";")[0], audio, (sent) => step("sending", sent));
  step("saving", 1);
  const finished = await fetch(`/api/recordings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "finish", durationMs: Math.round(recording.durationMs), tunes: recording.tunes.map(({ tuneId, settingId, startMs, endMs, rejected }) => ({ tuneId, settingId, startMs: Math.round(startMs), endMs: Math.round(endMs), rejected: !!rejected })) }) });
  if (!finished.ok) throw new Error((await finished.json()).error || "Could not save the setlist");
  await forget(recording.id);
  return id as string;
}

// Uploads in flight, shared by the tray (which uploads a recording when it stops) and the Recordings screen (which lists
// any still waiting), so neither starts a second upload of the same recording.
let uploadStates: Record<string, UploadState> = {};
const watchers = new Set<() => void>();
const CHANGED = "tunebook-recordings-changed";
function setUploads(update: (current: Record<string, UploadState>) => Record<string, UploadState>) { uploadStates = update(uploadStates); watchers.forEach((watcher) => watcher()); }
const watchUploads = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher); }; };
const announce = () => window.dispatchEvent(new Event(CHANGED));

// How long an uploaded recording shows its tick before taking its place among the others.
const DONE_MS = 1600;
const busy = (state?: UploadState) => !!state && state.status !== "failed" && state.status !== "done";

async function sendRecording(recording: LocalRecording) {
  if (busy(uploadStates[recording.id])) return;
  const step = (status: UploadState["status"], progress = 0, error?: string) => setUploads((current) => ({ ...current, [recording.id]: { id: recording.id, status, progress, recording, error } }));
  step("preparing");
  try {
    await upload(recording, step);
    trackEvent("session_recording_uploaded", { outcome: "success", tune_count: recording.tunes.length });
    step("done", 1);
    window.setTimeout(() => { setUploads((current) => { const next = { ...current }; delete next[recording.id]; return next; }); announce(); }, DONE_MS);
  } catch (cause) {
    trackEvent("session_recording_uploaded", { outcome: "error", tune_count: recording.tunes.length });
    step("failed", 0, cause instanceof Error ? cause.message : "Upload failed");
  }
  announce();
}

/**
 * Recordings kept on this device that have not uploaded: one stopped with no connection, or cut off by a reload. The
 * Recordings screen lists them, to upload or discard. It only reads them, so it never touches a recording in progress.
 */
export function usePendingRecordings() {
  const [pending, setPending] = useState<LocalRecording[]>([]);
  const uploads = useSyncExternalStore(watchUploads, () => uploadStates, () => uploadStates);
  const capable = useSyncExternalStore(() => () => undefined, () => typeof indexedDB !== "undefined", () => false);
  useEffect(() => {
    if (!capable) return;
    const refresh = () => void allMeta().then((all) => setPending(all.filter((r) => r.finished))).catch(() => undefined);
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [capable]);
  const discard = useCallback(async (id: string) => { await forget(id); announce(); }, []);
  return { pending, uploads, retry: sendRecording, discard };
}

/** `enabled` is false on screens that never record, so they do not touch IndexedDB. */
export function useSessionRecorder(enabled: boolean) {
  const [active, setActive] = useState<LocalRecording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<{ media: MediaRecorder; meta: LocalRecording; started: number; seq: number; timer: number; writing: Promise<unknown> } | null>(null);
  // Read like an external store so the server (which cannot record) and the first browser render agree.
  const capable = useSyncExternalStore(() => () => undefined, () => typeof MediaRecorder !== "undefined" && typeof indexedDB !== "undefined", () => false);
  const supported = enabled && capable;

  // Recordings cut off by a reload or a crash are closed off at their last chunk, for the Recordings screen to offer.
  // Only the tray does this, once, before it can be recording.
  useEffect(() => {
    if (!supported) return;
    void allMeta().then(async (all) => {
      for (const r of all.filter((r) => !r.finished)) await saveMeta({ ...r, finished: true, tunes: r.tunes.map((t) => ({ ...t, endMs: t.endMs || r.durationMs })) });
      announce();
    }).catch(() => undefined);
  }, [supported]);

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
    await sendRecording(meta);
  }, []);

  return { supported, active, elapsed, start, mark, reject, stop };
}
