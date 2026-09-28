import { and, asc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookShares, bookEntries, catalogSettings, folders, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { parseSessionUrl } from "@/lib/session-url";
import { getMySets } from "@/lib/sets";
import { getTuneEmojiSuggestion, withTuneEmojis, type TuneWithEmoji } from "@/lib/tune-emojis";

type Tune = TuneWithEmoji;
export type BookSection = { kind: "tune"; entryId: string; tune: Tune } | { kind: "set"; entryId: string; setId: string; name: string; tunes: Tune[] };

export async function getLibrary(userId: string) {
  const [allFolders, allBooks, allTunes, sharedBooks, sets] = await Promise.all([
    db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.name)),
    db.select().from(tunebooks).where(eq(tunebooks.userId, userId)).orderBy(asc(tunebooks.name)),
    db.select().from(savedTunes).where(eq(savedTunes.userId, userId)).orderBy(asc(savedTunes.title)),
    db.select({ id: tunebooks.id, name: tunebooks.name, emoji: tunebooks.emoji })
      .from(tunebooks).innerJoin(bookShares, eq(bookShares.bookId, tunebooks.id))
      .innerJoin(user, and(eq(user.id, userId), eq(user.emailVerified, true), eq(bookShares.email, sql`lower(${user.email})`)))
      .where(sql`${tunebooks.userId} <> ${userId}`).orderBy(asc(tunebooks.name)),
    getMySets(userId),
  ]);
  return { folders: allFolders, books: allBooks, tunes: await withTuneEmojis(allTunes), sharedBooks, sets };
}

export const isBookId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function getBook(userId: string | null, id: string) {
  if (!isBookId(id)) return null;
  const invited = userId ? exists(db.select({ id: bookShares.bookId }).from(bookShares)
    .innerJoin(user, and(eq(user.id, userId), eq(user.emailVerified, true), eq(bookShares.email, sql`lower(${user.email})`)))
    .where(eq(bookShares.bookId, tunebooks.id))) : undefined;
  const [book] = await db.select().from(tunebooks).where(and(eq(tunebooks.id, id),
    or(eq(tunebooks.linkVisible, true), ...(userId ? [eq(tunebooks.userId, userId), invited!] : [])))).limit(1);
  if (!book) return null;
  const entries = await db.select().from(bookEntries).where(eq(bookEntries.bookId, id)).orderBy(asc(bookEntries.position), asc(bookEntries.id));
  const tuneIds = entries.flatMap((entry) => entry.tuneId ? [entry.tuneId] : []);
  const setIds = entries.flatMap((entry) => entry.setId ? [entry.setId] : []);
  const [singles, sets, members] = await Promise.all([
    tuneIds.length ? db.select().from(savedTunes).where(and(inArray(savedTunes.id, tuneIds), eq(savedTunes.userId, book.userId))) : [],
    setIds.length ? db.select().from(tuneSets).where(and(inArray(tuneSets.id, setIds), eq(tuneSets.userId, book.userId))) : [],
    setIds.length ? db.select({ setId: setTunes.setId, tune: savedTunes }).from(setTunes)
      .innerJoin(savedTunes, eq(setTunes.tuneId, savedTunes.id))
      .where(and(inArray(setTunes.setId, setIds), eq(savedTunes.userId, book.userId))).orderBy(asc(setTunes.position)) : [],
  ]);
  const resolved = await withTuneEmojis([...singles, ...members.map((row) => row.tune)]);
  const byId = new Map(resolved.map((tune) => [tune.id, tune]));
  const sections: BookSection[] = [];
  for (const entry of entries) {
    if (entry.tuneId) {
      const tune = byId.get(entry.tuneId);
      if (tune) sections.push({ kind: "tune", entryId: entry.id, tune });
    } else {
      const set = sets.find((set) => set.id === entry.setId);
      if (set) sections.push({ kind: "set", entryId: entry.id, setId: set.id, name: set.name, tunes: members.filter((row) => row.setId === set.id).map((row) => byId.get(row.tune.id)!) });
    }
  }
  const tunes = sections.flatMap((section) => (section.kind === "tune" ? [section.tune] : section.tunes)
    .map((tune) => ({ tune, entryId: section.entryId, instanceId: `${section.entryId}-${tune.id}` }))).map((row, position) => ({ ...row, position }));
  return { book, sections, tunes };
}

export async function getSavedTune(userId: string, id: string) {
  const [tune] = await db.select().from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, id))).limit(1);
  return tune ? (await withTuneEmojis([tune]))[0] : null;
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
  await getTuneEmojiSuggestion(source.tuneId, source.title);
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
