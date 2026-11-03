import { randomUUID } from "node:crypto";
import type { MelodyIndex } from "@/lib/melody-index";
import { matchMelody, type MelodyMatch } from "@/lib/melody-match";
import { SAMPLE_RATE, YinTranscriber, type PlayedNote, type Transcriber } from "@/lib/pitch-tracker";

export type ListenStatus = "listening" | "confident" | "done";
export type Identification = { status: ListenStatus; notes: PlayedNote[]; matches: MelodyMatch[] };

export class ListenError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const MAX_SECONDS = 30;
const MAX_CHUNK_BYTES = 64 * 1024;
const IDLE_MS = 60_000;
const SESSIONS_PER_USER = 2;
// Long recordings drift through variations; the most recent phrase is the best evidence.
const QUERY_NOTES = 80;
const MIN_NOTES = 12;
const MIN_SCORE = 0.6;
const MIN_MARGIN = 0.1;
const STABLE_UPDATES = 3;

/** Ranks tunes for the notes heard so far and decides whether one is clearly ahead. */
export function identify(index: MelodyIndex, notes: PlayedNote[], seconds: number, leaders: number[] = []): Identification {
  const recent = notes.slice(-QUERY_NOTES);
  // Inter-onset intervals stand in for written lengths; only their ratios are compared.
  const durations = recent.map((note, i) => Math.round(1000 * (i + 1 < recent.length ? recent[i + 1].start - note.start : note.duration)));
  const matches = recent.length >= MIN_NOTES ? matchMelody(index, recent.map((note) => note.midi), durations) : [];
  if (matches[0]) leaders.push(matches[0].tuneId);
  const [first, second] = matches;
  const stable = leaders.length >= STABLE_UPDATES && leaders.slice(-STABLE_UPDATES).every((tuneId) => tuneId === first?.tuneId);
  const confident = !!first && first.score >= MIN_SCORE && first.score - (second?.score ?? 0) >= MIN_MARGIN && stable;
  return { status: confident ? "confident" : seconds >= MAX_SECONDS - 5 ? "done" : "listening", notes, matches };
}

type Session = { userId: string; transcriber: Transcriber; seq: number; leaders: number[]; lastSeen: number };
// Audio stays in this process's memory and is dropped with the session; it is never stored.
const globalSessions = globalThis as typeof globalThis & { __tunebookListenSessions?: Map<string, Session> };
const sessions = globalSessions.__tunebookListenSessions ??= new Map();

function sweep(now = Date.now()) {
  for (const [id, session] of sessions) if (now - session.lastSeen > IDLE_MS) sessions.delete(id);
}

export function startSession(userId: string) {
  sweep();
  const own = [...sessions].filter(([, session]) => session.userId === userId).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  // A new session replaces the oldest, so a reloaded page never locks the user out.
  while (own.length >= SESSIONS_PER_USER) sessions.delete(own.shift()![0]);
  const id = randomUUID();
  sessions.set(id, { userId, transcriber: new YinTranscriber(), seq: 0, leaders: [], lastSeen: Date.now() });
  return id;
}

function ownSession(userId: string, id: string) {
  sweep();
  const session = sessions.get(id);
  if (!session || session.userId !== userId) throw new ListenError("Listening session expired", 404);
  return session;
}

/** Adds a chunk of 16 kHz mono 16-bit PCM and returns the updated ranking. */
export function addAudio(index: MelodyIndex, userId: string, id: string, seq: number, chunk: ArrayBuffer): Identification {
  const session = ownSession(userId, id);
  if (seq !== session.seq) throw new ListenError("Audio arrived out of order", 409);
  if (chunk.byteLength > MAX_CHUNK_BYTES || chunk.byteLength % 2) throw new ListenError("Invalid audio chunk", 400);
  if (session.transcriber.seconds + chunk.byteLength / 2 / SAMPLE_RATE > MAX_SECONDS) throw new ListenError("Listening time is over", 413);
  session.seq++;
  session.lastSeen = Date.now();
  session.transcriber.push(new Int16Array(chunk));
  return identify(index, session.transcriber.notes(), session.transcriber.seconds, session.leaders);
}

export function endSession(userId: string, id: string) {
  if (sessions.get(id)?.userId === userId) sessions.delete(id);
}
