import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { savedTunes, tunePractice } from "@/db/schema";
import { resolvePractice, type Practice, type PracticeUpdate } from "@/lib/ability";
import type { TuneWithEmoji } from "@/lib/tune-emojis";

export type TuneWithPractice = TuneWithEmoji & { practice: Practice };
export class PracticeError extends Error {}

export async function withTunePractice<T extends { tuneId: number }>(userId: string | null, tunes: T[]) {
  const ids = [...new Set(tunes.map((tune) => tune.tuneId))];
  const rows = userId && ids.length ? await db.select().from(tunePractice)
    .where(and(eq(tunePractice.userId, userId), inArray(tunePractice.tuneId, ids))) : [];
  const byId = new Map(rows.map((row) => [row.tuneId, resolvePractice(row.playableTempo, row.levelOverride)]));
  return tunes.map((tune) => ({ ...tune, practice: byId.get(tune.tuneId) ?? resolvePractice() }));
}

export async function updateTunePractice(userId: string, savedTuneId: string, update: PracticeUpdate) {
  return db.transaction(async (tx) => {
    const [tune] = await tx.select({ tuneId: savedTunes.tuneId }).from(savedTunes)
      .where(and(eq(savedTunes.id, savedTuneId), eq(savedTunes.userId, userId))).for("share");
    if (!tune) throw new PracticeError("Tune not found");
    const values = update.operation === "tempo" ? { playableTempo: update.tempo }
      : update.operation === "level" ? { levelOverride: update.level } : { playableTempo: null, levelOverride: null };
    const changes = update.operation === "tempo" ? { playableTempo: sql<number>`greatest(${tunePractice.playableTempo}, ${update.tempo})` } : values;
    const [row] = await tx.insert(tunePractice).values({ userId, tuneId: tune.tuneId, ...values })
      .onConflictDoUpdate({ target: [tunePractice.userId, tunePractice.tuneId], set: { ...changes, updatedAt: new Date() } }).returning();
    return resolvePractice(row.playableTempo, row.levelOverride);
  });
}
