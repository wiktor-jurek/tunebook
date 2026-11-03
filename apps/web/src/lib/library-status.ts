import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookEntries, savedTunes, setTunes, tunebooks } from "@/db/schema";

// copyId is the saved copy the book holds, which may be another setting than the one the recording names.
export type BookMembership = { id: string; name: string; emoji: string | null; viaSet: boolean; copyId: string };

/**
 * For catalog tunes heard in a recording: the person's saved copy (the same setting if they have it, any
 * setting otherwise) and the tunebooks holding a copy, directly or inside a set. Also every tunebook they own.
 */
export async function libraryStatus(userId: string, tuneIds: number[]) {
  const ids = [...new Set(tuneIds)];
  const [saved, books] = await Promise.all([
    ids.length ? db.select({ id: savedTunes.id, tuneId: savedTunes.tuneId, settingId: savedTunes.settingId }).from(savedTunes)
      .where(and(eq(savedTunes.userId, userId), inArray(savedTunes.tuneId, ids))).orderBy(asc(savedTunes.createdAt)) : [],
    db.select({ id: tunebooks.id, name: tunebooks.name, emoji: tunebooks.emoji }).from(tunebooks).where(eq(tunebooks.userId, userId)).orderBy(asc(tunebooks.name)),
  ]);
  const savedIds = saved.map((row) => row.id);
  const [direct, viaSet] = savedIds.length ? await Promise.all([
    db.select({ savedId: bookEntries.tuneId, bookId: bookEntries.bookId }).from(bookEntries).where(inArray(bookEntries.tuneId, savedIds)),
    db.select({ savedId: setTunes.tuneId, bookId: bookEntries.bookId }).from(setTunes).innerJoin(bookEntries, eq(bookEntries.setId, setTunes.setId)).where(inArray(setTunes.tuneId, savedIds)),
  ]) : [[], []];
  const owned = new Map(books.map((book) => [book.id, book]));
  return {
    books,
    status(tuneId: number, settingId: number) {
      const copies = saved.filter((row) => row.tuneId === tuneId);
      const copyIds = new Set(copies.map((row) => row.id));
      const memberships = new Map<string, BookMembership>();
      for (const [rows, set] of [[viaSet, true], [direct, false]] as const) for (const row of rows) {
        const book = row.savedId && copyIds.has(row.savedId) ? owned.get(row.bookId) : undefined;
        if (book && row.savedId) memberships.set(book.id, { ...book, viaSet: set, copyId: row.savedId });
      }
      return { savedId: (copies.find((row) => row.settingId === settingId) ?? copies[0])?.id ?? null, inBooks: [...memberships.values()] };
    },
  };
}
