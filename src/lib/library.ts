import { and, asc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bookShares, bookEntries, bookPopularTunes, catalogSettings, catalogTunes, folders, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { parseSessionUrl } from "@/lib/session-url";
import { getMySets } from "@/lib/sets";
import { displaySetName } from "@/lib/set-name";
import { getTuneEmojiSuggestion, withTuneEmojis } from "@/lib/tune-emojis";
import { withTunePractice, type TuneWithPractice } from "@/lib/tune-practice";
import { libraryStatus } from "@/lib/library-status";
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

export async function searchCatalog(query: string) {
  const trimmed = query.trim().slice(0, 100);
  if (!trimmed) return [];
  const parsed = parseSessionUrl(trimmed);
  if (parsed) {
    return db.select().from(catalogSettings)
      .where(parsed.settingId ? eq(catalogSettings.settingId, parsed.settingId) : eq(catalogSettings.tuneId, parsed.tuneId))
      .orderBy(asc(catalogSettings.settingId)).limit(100);
  }
  // Titles are stored "Kesh, The", so a leading article is dropped: "The Kesh" and "Kesh" both find it.
  const words = trimmed.replace(/^(the|an?)\s+/i, "") || trimmed;
  const pattern = `%${words.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return db.select().from(catalogSettings)
    // Punctuation-blind too, so "cooleys" finds "Cooley's".
    .where(or(ilike(catalogSettings.title, pattern), sql`regexp_replace(lower(${catalogSettings.title}), '[^a-z0-9 ]', '', 'g') LIKE ${`%${bare(words)}%`}`, sql`${catalogSettings.tuneId}::text = ${trimmed}`))
    .orderBy(asc(catalogSettings.title), asc(catalogSettings.settingId)).limit(50);
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
const likePattern = (value: string) => `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

// One row per tune: the first setting matching every filter represents the tune.
export async function searchCatalogTunes(filters: CatalogTuneFilters) {
  const conditions = [sql`true`];
  const query = filters.query?.trim().slice(0, 100);
  if (query) {
    const parsed = parseSessionUrl(query);
    if (parsed) conditions.push(parsed.settingId ? sql`cs.setting_id = ${parsed.settingId}` : sql`cs.tune_id = ${parsed.tuneId}`);
    else conditions.push(sql`(${sql.join(titleVariants(query).map((title) => sql`cs.title ILIKE ${likePattern(title)}`), sql` OR `)} OR cs.tune_id::text = ${query})`);
  }
  if (filters.kind) conditions.push(sql`lower(cs.kind) = lower(${filters.kind})`);
  if (filters.meter) conditions.push(sql`cs.meter = ${filters.meter}`);
  if (filters.tonic) conditions.push(sql`cs.mode ~ ${`^${filters.tonic}[a-z]+$`}`);
  if (filters.mode) conditions.push(sql`lower(cs.mode) ~ ${`^[a-g][#b]?${filters.mode.toLowerCase()}$`}`);
  if (filters.minTunebooks) conditions.push(sql`coalesce(ct.tunebooks, 0) >= ${filters.minTunebooks}`);
  const order = filters.sort === "title" ? sql`title ASC, "tuneId" ASC` : sql`tunebooks DESC, title ASC, "tuneId" ASC`;
  const result = await db.execute<CatalogTune & { total: number }>(sql`
    SELECT *, count(*) OVER ()::integer AS total FROM (
      SELECT DISTINCT ON (cs.tune_id) cs.tune_id AS "tuneId", cs.setting_id AS "settingId", cs.title, cs.kind, cs.meter, cs.mode,
        cs.source_url AS "sourceUrl", coalesce(ct.tunebooks, 0)::integer AS tunebooks,
        count(*) OVER (PARTITION BY cs.tune_id)::integer AS "matchingSettings"
      FROM catalog_settings cs LEFT JOIN catalog_tunes ct ON ct.tune_id = cs.tune_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY cs.tune_id, cs.setting_id
    ) tunes
    ORDER BY ${order} LIMIT ${filters.limit} OFFSET ${filters.offset}
  `);
  const total = result.rows[0]?.total ?? (filters.offset ? await countCatalogTunes(conditions) : 0);
  return { total, tunes: result.rows as CatalogTune[] };
}

// An offset past the end returns no rows, so the total needs its own count.
async function countCatalogTunes(conditions: SQL[]) {
  const result = await db.execute<{ total: number }>(sql`
    SELECT count(DISTINCT cs.tune_id)::integer AS total
    FROM catalog_settings cs LEFT JOIN catalog_tunes ct ON ct.tune_id = cs.tune_id
    WHERE ${sql.join(conditions, sql` AND `)}
  `);
  return result.rows[0]?.total ?? 0;
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
