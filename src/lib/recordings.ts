import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalogSettings, recordingTunes, recordings } from "@/db/schema";
import { deleteBlob, signedBlobUploadUrl, signedBlobUrl } from "@/lib/blob";
import { withTunePractice } from "@/lib/tune-practice";
import { libraryStatus } from "@/lib/library-status";
export type { BookMembership } from "@/lib/library-status";

// Recordings are titled by their day, in English like the rest of the app. Stored names carry the phone's locale.
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const recordingTitle = (recordedAt: Date) => DAY.format(recordedAt);
export const recordingLength = (ms: number) => { const m = Math.round(ms / 60000); return m < 1 ? "Under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export class RecordingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" };
export const RECORDING_TYPES = Object.keys(EXTENSIONS);

/** Starts a recording's upload: the row stays hidden until finishRecording, and the browser PUTs the audio to uploadUrl. */
export async function createRecording(userId: string, input: { name: string; mime: string; recordedAt: Date }) {
  const base = input.mime.split(";")[0];
  if (!EXTENSIONS[base]) throw new RecordingError("This audio format cannot be stored", 400);
  const id = crypto.randomUUID();
  const storageKey = `recordings/${userId}/${id}.${EXTENSIONS[base]}`;
  const uploadUrl = signedBlobUploadUrl(storageKey);
  if (!uploadUrl) throw new RecordingError("Recording storage is not set up", 503);
  await db.insert(recordings).values({ id, userId, name: input.name, storageKey, mime: base, recordedAt: input.recordedAt });
  return { id, uploadUrl };
}

/** Marks an uploaded recording finished and stores its setlist. */
export async function finishRecording(userId: string, id: string, input: { durationMs: number; tunes: { tuneId: number; settingId: number; startMs: number; endMs: number; rejected?: boolean }[] }) {
  await db.transaction(async (tx) => {
    const [row] = await tx.update(recordings).set({ durationMs: input.durationMs, uploadedAt: new Date() })
      .where(and(eq(recordings.id, id), eq(recordings.userId, userId))).returning({ id: recordings.id });
    if (!row) throw new RecordingError("Recording not found", 404);
    await tx.delete(recordingTunes).where(eq(recordingTunes.recordingId, id));
    if (input.tunes.length) await tx.insert(recordingTunes).values(input.tunes.map((tune) => ({ ...tune, recordingId: id })));
  });
}

export async function listRecordings(userId: string) {
  // A join rather than a correlated subquery: Drizzle leaves single-table columns unqualified, so "id" inside a subquery would mean recording_tunes.id.
  return db.select({ id: recordings.id, name: recordings.name, durationMs: recordings.durationMs, recordedAt: recordings.recordedAt, tunes: sql<number>`count(${recordingTunes.id})::integer`,
    // The first tunes heard, so two recordings from the same day can be told apart.
    firstTunes: sql<string[]>`coalesce((array_agg(${catalogSettings.title} ORDER BY ${recordingTunes.startMs}) FILTER (WHERE ${catalogSettings.title} IS NOT NULL))[1:3], '{}')` })
    .from(recordings).leftJoin(recordingTunes, and(eq(recordingTunes.recordingId, recordings.id), eq(recordingTunes.rejected, false)))
    .leftJoin(catalogSettings, eq(catalogSettings.settingId, recordingTunes.settingId))
    .where(and(eq(recordings.userId, userId), isNotNull(recordings.uploadedAt)))
    .groupBy(recordings.id).orderBy(desc(recordings.recordedAt));
}

export async function getRecording(userId: string, id: string) {
  const [recording] = await db.select().from(recordings).where(and(eq(recordings.id, id), eq(recordings.userId, userId), isNotNull(recordings.uploadedAt))).limit(1);
  if (!recording) return null;
  const tunes = await db.select({ id: recordingTunes.id, tuneId: recordingTunes.tuneId, settingId: recordingTunes.settingId, startMs: recordingTunes.startMs, endMs: recordingTunes.endMs,
    title: catalogSettings.title, kind: catalogSettings.kind, meter: catalogSettings.meter, mode: catalogSettings.mode, abc: catalogSettings.abc })
    .from(recordingTunes).innerJoin(catalogSettings, eq(catalogSettings.settingId, recordingTunes.settingId))
    .where(and(eq(recordingTunes.recordingId, id), eq(recordingTunes.rejected, false))).orderBy(asc(recordingTunes.startMs));
  const [withPractice, library] = await Promise.all([withTunePractice(userId, tunes), libraryStatus(userId, tunes.map((tune) => tune.tuneId))]);
  return { ...recording, audioUrl: signedBlobUrl(recording.storageKey), books: library.books,
    tunes: withPractice.map((tune) => ({ ...tune, ...library.status(tune.tuneId, tune.settingId) })) };
}

export async function removeRecordingTune(userId: string, recordingId: string, entryId: string) {
  const owned = await db.select({ id: recordings.id }).from(recordings).where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId))).limit(1);
  if (!owned.length) throw new RecordingError("Recording not found", 404);
  // Kept, not deleted: a tune named wrongly is training data for the finder.
  await db.update(recordingTunes).set({ rejected: true }).where(and(eq(recordingTunes.id, entryId), eq(recordingTunes.recordingId, recordingId)));
}

/** Deletes the recording, its setlist and its audio in the bucket. */
export async function deleteRecording(userId: string, id: string) {
  const [row] = await db.delete(recordings).where(and(eq(recordings.id, id), eq(recordings.userId, userId))).returning({ storageKey: recordings.storageKey });
  if (!row) throw new RecordingError("Recording not found", 404);
  // The recording is already gone for the person; if the audio cannot be removed, log its key so it can be cleared by hand.
  try { await deleteBlob(row.storageKey); } catch (error) { console.error("Recording audio left in storage", row.storageKey, error); }
}
