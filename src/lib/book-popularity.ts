import { and, eq, exists, or } from "drizzle-orm";
import { db } from "@/db";
import { bookEntries, bookPopularTunes, savedTunes, setTunes, tunebooks } from "@/db/schema";

export class BookPopularityError extends Error {}

export async function updateBookPopularity(userId: string, bookId: string, savedTuneId: string, oftenPlayed: boolean) {
  return db.transaction(async (tx) => {
    const [book] = await tx.select({ id: tunebooks.id }).from(tunebooks)
      .where(and(eq(tunebooks.id, bookId), eq(tunebooks.userId, userId))).for("update");
    if (!book) throw new BookPopularityError("Tunebook not found");
    const inSet = exists(tx.select({ id: setTunes.tuneId }).from(setTunes)
      .where(and(eq(setTunes.setId, bookEntries.setId), eq(setTunes.tuneId, savedTunes.id))));
    const inBook = exists(tx.select({ id: bookEntries.id }).from(bookEntries)
      .where(and(eq(bookEntries.bookId, bookId), or(eq(bookEntries.tuneId, savedTunes.id), inSet))));
    const [tune] = await tx.select({ tuneId: savedTunes.tuneId }).from(savedTunes)
      .where(and(eq(savedTunes.id, savedTuneId), eq(savedTunes.userId, userId), inBook)).limit(1);
    if (!tune) throw new BookPopularityError("Tune not found in this tunebook");
    if (oftenPlayed) await tx.insert(bookPopularTunes).values({ bookId, tuneId: tune.tuneId }).onConflictDoNothing();
    else await tx.delete(bookPopularTunes).where(and(eq(bookPopularTunes.bookId, bookId), eq(bookPopularTunes.tuneId, tune.tuneId)));
    return { tuneId: tune.tuneId, oftenPlayed };
  });
}
