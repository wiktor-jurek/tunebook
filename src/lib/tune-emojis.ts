import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalogSettings, savedTunes, tuneEmojiSuggestions } from "@/db/schema";
import { SMART_EMOJI_VERSION, suggestTuneEmoji } from "@/lib/smart-emoji";

export type TuneWithEmoji = typeof savedTunes.$inferSelect & { emoji: string; suggestedEmoji: string };
export class TuneEmojiError extends Error {}

export async function getTuneEmojiSuggestion(tuneId: number, title: string): Promise<string> {
  const [cached] = await db.select().from(tuneEmojiSuggestions).where(eq(tuneEmojiSuggestions.tuneId, tuneId)).limit(1);
  if (cached) return cached.emoji;
  return db.transaction(async (tx) => {
    // Serialize first-time suggestions across requests/processes, without blocking cached reads.
    await tx.execute(sql`select pg_advisory_xact_lock(63157, ${tuneId})`);
    const [existing] = await tx.select().from(tuneEmojiSuggestions).where(eq(tuneEmojiSuggestions.tuneId, tuneId)).limit(1);
    if (existing) return existing.emoji;
    const [canonical] = await tx.select({ title: catalogSettings.title }).from(catalogSettings)
      .where(eq(catalogSettings.tuneId, tuneId)).orderBy(asc(catalogSettings.settingId)).limit(1);
    const emoji = suggestTuneEmoji(canonical?.title ?? title);
    await tx.insert(tuneEmojiSuggestions).values({ tuneId, emoji, matcherVersion: SMART_EMOJI_VERSION });
    return emoji;
  });
}

export async function withTuneEmojis<T extends { tuneId: number; title: string; emojiOverride: string | null }>(tunes: T[]) {
  if (!tunes.length) return [] as (T & { emoji: string; suggestedEmoji: string })[];
  const unique = new Map(tunes.map((tune) => [tune.tuneId, tune.title]));
  const cached = await db.select().from(tuneEmojiSuggestions).where(inArray(tuneEmojiSuggestions.tuneId, [...unique.keys()]));
  const suggestions = new Map(cached.map((row) => [row.tuneId, row.emoji]));
  // Existing saved tunes are filled lazily, once per catalog tune; no catalog-wide migration is needed.
  for (const [tuneId, title] of unique) if (!suggestions.has(tuneId)) suggestions.set(tuneId, await getTuneEmojiSuggestion(tuneId, title));
  return tunes.map((tune) => ({ ...tune, suggestedEmoji: suggestions.get(tune.tuneId)!, emoji: tune.emojiOverride ?? suggestions.get(tune.tuneId)! }));
}

export async function setTuneEmojiOverride(userId: string, tuneId: string, emoji: string | null) {
  const changed = await db.update(savedTunes).set({ emojiOverride: emoji })
    .where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, tuneId))).returning({ id: savedTunes.id });
  if (!changed.length) throw new TuneEmojiError("Tune not found");
}
