import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookTunes, catalogSettings, folders, savedTunes, tunebooks } from "@/db/schema";
import { parseSessionUrl } from "@/lib/session-url";

export async function getLibrary(userId: string) {
  const [allFolders, allBooks, allTunes] = await Promise.all([
    db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.name)),
    db.select().from(tunebooks).where(eq(tunebooks.userId, userId)).orderBy(asc(tunebooks.name)),
    db.select().from(savedTunes).where(eq(savedTunes.userId, userId)).orderBy(asc(savedTunes.title)),
  ]);
  return { folders: allFolders, books: allBooks, tunes: allTunes };
}

export async function getBook(userId: string, id: string) {
  const [book] = await db.select().from(tunebooks).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, id))).limit(1);
  if (!book) return null;
  const tunes = await db.select({ position: bookTunes.position, tune: savedTunes })
    .from(bookTunes).innerJoin(savedTunes, eq(bookTunes.tuneId, savedTunes.id))
    .where(and(eq(bookTunes.bookId, id), eq(savedTunes.userId, userId)))
    .orderBy(asc(bookTunes.position));
  return { book, tunes };
}

export async function getSavedTune(userId: string, id: string) {
  const [tune] = await db.select().from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, id))).limit(1);
  return tune ?? null;
}

export async function searchCatalog(query: string) {
  const trimmed = query.trim().slice(0, 100);
  if (!trimmed) return [];
  const parsed = parseSessionUrl(trimmed);
  if (parsed) {
    return db.select().from(catalogSettings)
      .where(parsed.settingId ? eq(catalogSettings.settingId, parsed.settingId) : eq(catalogSettings.tuneId, parsed.tuneId))
      .orderBy(asc(catalogSettings.settingId)).limit(100);
  }
  const pattern = `%${trimmed.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return db.select().from(catalogSettings)
    .where(or(ilike(catalogSettings.title, pattern), sql`${catalogSettings.tuneId}::text = ${trimmed}`))
    .orderBy(asc(catalogSettings.title), asc(catalogSettings.settingId)).limit(50);
}

export async function saveCatalogSetting(userId: string, settingId: number) {
  const [source] = await db.select().from(catalogSettings).where(eq(catalogSettings.settingId, settingId)).limit(1);
  if (!source) throw new Error("Setting not found in the catalog");
  const [saved] = await db.insert(savedTunes).values({
    userId,
    settingId: source.settingId,
    tuneId: source.tuneId,
    title: source.title,
    kind: source.kind,
    meter: source.meter,
    mode: source.mode,
    abc: source.abc,
    contributor: source.contributor,
    composer: source.composer,
    sourceUrl: source.sourceUrl,
  }).onConflictDoUpdate({
    target: [savedTunes.userId, savedTunes.settingId],
    set: { settingId: sql`${savedTunes.settingId}` },
  }).returning({ id: savedTunes.id });
  return saved.id;
}
