import { and, asc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookShares, bookEntries, bookPopularTunes, catalogSettings, catalogTunes, folders, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { parseSessionUrl } from "@/lib/session-url";
import { getMySets } from "@/lib/sets";
import { displaySetName } from "@/lib/set-name";
import { getTuneEmojiSuggestion, withTuneEmojis } from "@/lib/tune-emojis";
import { withTunePractice, type TuneWithPractice } from "@/lib/tune-practice";
import { libraryStatus } from "@/lib/library-status";
import { matchesPreparedWord, preparedSearchRank, prepareSearchTune, searchWords, type PreparedSearchTune } from "@/lib/titles";
import type { AbilityLevel } from "@/lib/ability";

type Tune = TuneWithPractice & { oftenPlayed: boolean };
export type BookSection = { kind: "tune"; entryId: string; tune: Tune } | { kind: "set"; entryId: string; setId: string; name: string; autoName: boolean; tunes: Tune[] };

export async function getLibrary(userId: string) {
  const [allFolders, allBooks, allTunes, sharedBooks, sets] = await Promise.all([
    db.select().from(folders).where(eq(folders.userId, userId)).orderBy(asc(folders.name)),
    db.select().from(tunebooks).where(eq(tunebooks.userId, userId)).orderBy(asc(tunebooks.name)),
    getSavedTunes(userId),
    db.select({ id: tunebooks.id, name: tunebooks.name, emoji: tunebooks.emoji })
      .from(tunebooks).innerJoin(bookShares, eq(bookShares.bookId, tunebooks.id))
      .innerJoin(user, and(eq(user.id, userId), eq(user.emailVerified, true), eq(bookShares.email, sql`lower(${user.email})`)))
      .where(sql`${tunebooks.userId} <> ${userId}`).orderBy(asc(tunebooks.name)),
    getMySets(userId),
  ]);
  return { folders: allFolders, books: allBooks, tunes: allTunes, sharedBooks, sets };
}

export type TuneBook = { id: string; name: string; emoji: string | null; tuneIds: string[] };

/** Each of the person's tunebooks with the saved tunes in it (a set's tunes included), in playing order. */
export async function getTuneBooks(userId: string): Promise<TuneBook[]> {
  const rows = await db.execute<{ id: string; name: string; emoji: string | null; tuneId: string | null }>(sql`
    SELECT b.id, b.name, b.emoji, coalesce(be.tune_id, st.tune_id) AS "tuneId"
    FROM ${tunebooks} b
    LEFT JOIN ${bookEntries} be ON be.book_id = b.id
    LEFT JOIN ${setTunes} st ON st.set_id = be.set_id
    WHERE b.user_id = ${userId}
    ORDER BY lower(b.name), b.id, be.position, st.position`);
  const books = new Map<string, TuneBook>();
  for (const row of rows.rows) {
    const book = books.get(row.id) ?? { id: row.id, name: row.name, emoji: row.emoji, tuneIds: [] };
    if (row.tuneId && !book.tuneIds.includes(row.tuneId)) book.tuneIds.push(row.tuneId);
    books.set(row.id, book);
  }
  return [...books.values()];
}

export async function getSavedTunes(userId: string) {
  const tunes = await db.select().from(savedTunes).where(eq(savedTunes.userId, userId)).orderBy(asc(savedTunes.title));
  return withTunePractice(userId, await withTuneEmojis(tunes));
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
  const [singles, sets, members, popular] = await Promise.all([
    tuneIds.length ? db.select().from(savedTunes).where(and(inArray(savedTunes.id, tuneIds), eq(savedTunes.userId, book.userId))) : [],
    setIds.length ? db.select().from(tuneSets).where(and(inArray(tuneSets.id, setIds), eq(tuneSets.userId, book.userId))) : [],
    setIds.length ? db.select({ setId: setTunes.setId, tune: savedTunes }).from(setTunes)
      .innerJoin(savedTunes, eq(setTunes.tuneId, savedTunes.id))
      .where(and(inArray(setTunes.setId, setIds), eq(savedTunes.userId, book.userId))).orderBy(asc(setTunes.position)) : [],
    db.select({ tuneId: bookPopularTunes.tuneId }).from(bookPopularTunes).where(eq(bookPopularTunes.bookId, id)),
  ]);
  // Practice belongs to the viewer, never to the owner of a shared book.
  const resolved = await withTunePractice(userId, await withTuneEmojis([...singles, ...members.map((row) => row.tune)]));
  const popularIds = new Set(popular.map((row) => row.tuneId));
  const byId = new Map(resolved.map((tune) => [tune.id, { ...tune, oftenPlayed: popularIds.has(tune.tuneId) }]));
  const sections: BookSection[] = [];
  for (const entry of entries) {
    if (entry.tuneId) {
      const tune = byId.get(entry.tuneId);
      if (tune) sections.push({ kind: "tune", entryId: entry.id, tune });
    } else {
      const set = sets.find((set) => set.id === entry.setId);
      if (set) {
        const tunes = members.filter((row) => row.setId === set.id).map((row) => byId.get(row.tune.id)!);
        sections.push({ kind: "set", entryId: entry.id, setId: set.id, name: displaySetName(set, tunes), autoName: set.autoName, tunes });
      }
    }
  }
  const tunes = sections.flatMap((section) => (section.kind === "tune" ? [section.tune] : section.tunes)
    .map((tune) => ({ tune, entryId: section.entryId, instanceId: `${section.entryId}-${tune.id}` }))).map((row, position) => ({ ...row, position }));
  return { book, sections, tunes };
}

// What a link preview may show: only books anyone with the link can open, so restricted titles never leak.
export async function getBookPreview(id: string) {
  if (!isBookId(id)) return null;
  const result = await db.execute<{ name: string; emoji: string | null; owner: string; tunes: number; sets: number }>(sql`
    SELECT tb.name, tb.emoji, u.name AS owner,
      (SELECT count(DISTINCT st.tune_id) FROM ${bookEntries} be LEFT JOIN ${setTunes} s ON s.set_id = be.set_id
        JOIN ${savedTunes} st ON st.id = coalesce(be.tune_id, s.tune_id) WHERE be.book_id = tb.id)::integer AS tunes,
      (SELECT count(*) FROM ${bookEntries} be WHERE be.book_id = tb.id AND be.set_id IS NOT NULL)::integer AS sets
    FROM ${tunebooks} tb JOIN ${user} u ON u.id = tb.user_id
    WHERE tb.id = ${id} AND tb.link_visible
  `);
  return result.rows[0] ?? null;
}

export async function getSavedTune(userId: string, id: string) {
  const [tune] = await db.select().from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, id))).limit(1);
  return tune ? (await withTunePractice(userId, await withTuneEmojis([tune])))[0] : null;
}

/** Lower case, letters, digits and spaces only, with no leading article: how titles are compared. */
export const bare = (text: string) => text.toLowerCase().replace(/^(the|an?)\s+/, "").replace(/[^a-z0-9 ]/g, "").trim();

export type CatalogSettingRow = {
  settingId: number;
  tuneId: number;
  title: string;
  kind: string | null;
  meter: string | null;
  mode: string | null;
  contributor: string | null;
  composer: string | null;
  sourceUrl: string;
  tunebooks: number;
};

type IndexedCatalogSetting = CatalogSettingRow & { prepared: PreparedSearchTune };

const globalCatalog = globalThis as typeof globalThis & {
  __tunebookCatalogDb?: object;
  __tunebookCatalogIndex?: Promise<IndexedCatalogSetting[]>;
};

/**
 * Loads the catalog's searchable metadata once per server process (without the heavy ABC text),
 * so title, type, key and composer searches answer in a millisecond without a database round-trip.
 */
export function getCatalogIndex(): Promise<IndexedCatalogSetting[]> {
  const currentDb = db as object;
  if (globalCatalog.__tunebookCatalogDb === currentDb && globalCatalog.__tunebookCatalogIndex) {
    return globalCatalog.__tunebookCatalogIndex;
  }
  const promise = (async () => {
    const result = await db.execute<CatalogSettingRow>(sql`
      SELECT cs.setting_id AS "settingId", cs.tune_id AS "tuneId", cs.title, cs.kind, cs.meter, cs.mode,
        cs.contributor, cs.composer, cs.source_url AS "sourceUrl", coalesce(ct.tunebooks, 0)::integer AS tunebooks
      FROM catalog_settings cs LEFT JOIN catalog_tunes ct ON ct.tune_id = cs.tune_id
      ORDER BY cs.tune_id, cs.setting_id
    `);
    if (!result.rows.length && globalCatalog.__tunebookCatalogDb === currentDb) {
      globalCatalog.__tunebookCatalogIndex = undefined;
    }
    return result.rows.map((row) => ({ ...row, prepared: prepareSearchTune(row) }));
  })().catch((error) => {
    if (globalCatalog.__tunebookCatalogDb === currentDb) globalCatalog.__tunebookCatalogIndex = undefined;
    throw error;
  });
  globalCatalog.__tunebookCatalogDb = currentDb;
  globalCatalog.__tunebookCatalogIndex = promise;
  return promise;
}

export async function searchCatalog(query: string): Promise<CatalogSettingRow[]> {
  const trimmed = query.trim().slice(0, 100);
  if (!trimmed) return [];
  const settings = await getCatalogIndex();
  const parsed = parseSessionUrl(trimmed);
  if (parsed) {
    return settings
      .filter((s) => (parsed.settingId ? s.settingId === parsed.settingId : s.tuneId === parsed.tuneId))
      .sort((a, b) => a.settingId - b.settingId)
      .slice(0, 100);
  }
  const words = searchWords(trimmed);
  const numericId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  if (!words.length && numericId === null) return [];
  const matched: { setting: IndexedCatalogSetting; rank: number }[] = [];
  for (const setting of settings) {
    const idMatch = numericId !== null && (setting.tuneId === numericId || setting.settingId === numericId);
    if (!idMatch && !words.every((word, index) => matchesPreparedWord(setting.prepared, word, index === words.length - 1))) continue;
    matched.push({ setting, rank: preparedSearchRank(setting.prepared, words, numericId) });
  }
  matched.sort((a, b) => a.rank - b.rank || b.setting.tunebooks - a.setting.tunebooks || a.setting.title.localeCompare(b.setting.title) || a.setting.settingId - b.setting.settingId);
  return matched.slice(0, 50).map(({ setting: { settingId, tuneId, title, kind, meter, mode, contributor, composer, sourceUrl, tunebooks } }) => ({
    settingId, tuneId, title, kind, meter, mode, contributor, composer, sourceUrl, tunebooks,
  }));
}

export type CatalogTuneFilters = {
  query?: string; kind?: string; tonic?: string; mode?: string; meter?: string;
  minTunebooks?: number; sort: "popularity" | "title"; limit: number; offset: number;
};
export type CatalogTune = {
  tuneId: number; settingId: number; title: string; kind: string | null; meter: string | null; mode: string | null;
  tunebooks: number; matchingSettings: number; sourceUrl: string;
};

// The Session files many titles with a trailing article, e.g. "Kesh, The".
export function titleVariants(query: string) {
  const trimmed = query.trim().replace(/\s+/g, " ");
  const article = /^(the|an|a)\s+(.+)$/i.exec(trimmed);
  return article ? [trimmed, `${article[2]}, ${article[1][0].toUpperCase()}${article[1].slice(1).toLowerCase()}`] : [trimmed];
}

// One row per tune: the first setting matching every filter represents the tune.
export async function searchCatalogTunes(filters: CatalogTuneFilters) {
  const settings = await getCatalogIndex();
  const query = filters.query?.trim().slice(0, 100) ?? "";
  const parsed = query ? parseSessionUrl(query) : null;
  const words = query && !parsed ? searchWords(query) : [];
  const numericId = !parsed && /^\d+$/.test(query) ? Number(query) : null;
  const kindFilter = filters.kind?.toLowerCase();
  const tonicRe = filters.tonic ? new RegExp(`^${filters.tonic}[a-z]+$`) : null;
  const modeRe = filters.mode ? new RegExp(`^[a-g][#b]?${filters.mode.toLowerCase()}$`, "i") : null;
  const minTunebooks = filters.minTunebooks ?? 0;

  const byTune = new Map<number, { tune: CatalogTune; rank: number }>();
  for (const s of settings) {
    if (minTunebooks && s.tunebooks < minTunebooks) continue;
    if (kindFilter && s.kind?.toLowerCase() !== kindFilter) continue;
    if (filters.meter && s.meter !== filters.meter) continue;
    if (tonicRe && !tonicRe.test(s.mode ?? "")) continue;
    if (modeRe && !modeRe.test(s.mode ?? "")) continue;
    if (parsed) {
      if (parsed.settingId ? s.settingId !== parsed.settingId : s.tuneId !== parsed.tuneId) continue;
    } else if (words.length || numericId !== null) {
      const idMatch = numericId !== null && (s.tuneId === numericId || s.settingId === numericId);
      if (!idMatch && !words.every((word, index) => matchesPreparedWord(s.prepared, word, index === words.length - 1))) continue;
    }
    const existing = byTune.get(s.tuneId);
    if (existing) {
      existing.tune.matchingSettings++;
    } else {
      byTune.set(s.tuneId, {
        tune: {
          tuneId: s.tuneId,
          settingId: s.settingId,
          title: s.title,
          kind: s.kind,
          meter: s.meter,
          mode: s.mode,
          tunebooks: s.tunebooks,
          matchingSettings: 1,
          sourceUrl: s.sourceUrl,
        },
        rank: preparedSearchRank(s.prepared, words, numericId),
      });
    }
  }
  const all = [...byTune.values()];
  const titleCmp = (a: CatalogTune, b: CatalogTune) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || a.tuneId - b.tuneId;
  all.sort(filters.sort === "title"
    ? (a, b) => titleCmp(a.tune, b.tune)
    : (a, b) => a.rank - b.rank || b.tune.tunebooks - a.tune.tunebooks || titleCmp(a.tune, b.tune));
  const tunes = all.slice(filters.offset, filters.offset + filters.limit).map((entry) => entry.tune);
  return { total: all.length, tunes };
}

export async function getCatalogTune(tuneId: number) {
  const [settings, [popularity]] = await Promise.all([
    db.select().from(catalogSettings).where(eq(catalogSettings.tuneId, tuneId)).orderBy(asc(catalogSettings.settingId)),
    db.select({ tunebooks: catalogTunes.tunebooks }).from(catalogTunes).where(eq(catalogTunes.tuneId, tuneId)).limit(1),
  ]);
  return { settings, tunebooks: popularity?.tunebooks ?? 0 };
}

// What the Tune finder shows for the tunes it heard: each tune's first setting, its popularity,
// and the user's saved copy if they have one.
// What the tune finder shows for a heard tune: enough of a setting to start playing (its ABC), and for a
// signed-in person, whether they already know it and where it is in their library.
export type FinderTune = {
  tuneId: number; settingId: number; title: string; kind: string | null; meter: string | null; mode: string | null; abc: string; tunebooks: number;
  savedId: string | null; level: AbilityLevel; inBooks: { id: string; name: string; emoji: string | null }[];
};
// Guests (no userId) get the catalog's first setting and no library details.
export async function getFinderTunes(userId: string | null, tuneIds: number[]): Promise<FinderTune[]> {
  if (!tuneIds.length) return [];
  const result = await db.execute<Omit<FinderTune, "savedId" | "level" | "inBooks">>(sql`
    SELECT DISTINCT ON (cs.tune_id) cs.tune_id AS "tuneId", cs.setting_id AS "settingId", cs.title, cs.kind, cs.meter, cs.mode, cs.abc,
      coalesce(ct.tunebooks, 0)::integer AS tunebooks
    FROM catalog_settings cs LEFT JOIN catalog_tunes ct ON ct.tune_id = cs.tune_id
    WHERE cs.tune_id IN (${sql.join(tuneIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY cs.tune_id, cs.setting_id
  `);
  const catalog = result.rows;
  if (!userId) return catalog.map((tune) => ({ ...tune, savedId: null, level: "unlearned", inBooks: [] }));
  // A tune the person has saved shows their own setting: the one they play.
  const [saved, practice, library] = await Promise.all([
    db.select().from(savedTunes).where(and(eq(savedTunes.userId, userId), inArray(savedTunes.tuneId, tuneIds))).orderBy(asc(savedTunes.createdAt)),
    withTunePractice(userId, catalog),
    libraryStatus(userId, tuneIds),
  ]);
  return catalog.map((tune, i) => {
    const own = saved.find((row) => row.tuneId === tune.tuneId);
    const status = library.status(tune.tuneId, own?.settingId ?? tune.settingId);
    const base = own ? { ...tune, settingId: own.settingId, title: own.title, kind: own.kind, meter: own.meter, mode: own.mode, abc: own.abc } : tune;
    return { ...base, savedId: status.savedId, level: practice[i].practice.level, inBooks: status.inBooks.map(({ id, name, emoji }) => ({ id, name, emoji })) };
  });
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
