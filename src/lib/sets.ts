import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookEntries, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";
import { withTuneEmojis } from "@/lib/tune-emojis";
import { defaultSetName, displaySetName } from "@/lib/set-name";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class SetError extends Error {}

export async function getMySets(userId: string) {
  const sets = await db.select().from(tuneSets).where(eq(tuneSets.userId, userId)).orderBy(asc(tuneSets.name), asc(tuneSets.id));
  if (!sets.length) return [];
  const ids = sets.map((set) => set.id);
  const [members, books] = await Promise.all([
    db.select({ setId: setTunes.setId, tune: savedTunes }).from(setTunes)
      .innerJoin(savedTunes, eq(setTunes.tuneId, savedTunes.id))
      .where(and(inArray(setTunes.setId, ids), eq(savedTunes.userId, userId))).orderBy(asc(setTunes.position)),
    db.select({ setId: bookEntries.setId, id: tunebooks.id, name: tunebooks.name }).from(bookEntries)
      .innerJoin(tunebooks, eq(bookEntries.bookId, tunebooks.id))
      .where(and(inArray(bookEntries.setId, ids), eq(tunebooks.userId, userId))).orderBy(asc(tunebooks.name)),
  ]);
  const resolved = await withTuneEmojis(members.map((row) => row.tune));
  const byId = new Map(resolved.map((tune) => [tune.id, tune]));
  return sets.map((set) => {
    const tunes = members.filter((row) => row.setId === set.id).map((row) => byId.get(row.tune.id)!);
    return { ...set, name: displaySetName(set, tunes), tunes, books: books.filter((row) => row.setId === set.id).map(({ id, name }) => ({ id, name })) };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

async function lockBook(tx: Transaction, userId: string, bookId: string) {
  const [book] = await tx.select({ id: tunebooks.id }).from(tunebooks).where(and(eq(tunebooks.id, bookId), eq(tunebooks.userId, userId))).for("update");
  if (!book) throw new SetError("Tunebook not found");
  return tx.select().from(bookEntries).where(eq(bookEntries.bookId, bookId)).orderBy(asc(bookEntries.position), asc(bookEntries.id));
}

async function ownSet(tx: Transaction, userId: string, setId: string) {
  const [set] = await tx.select().from(tuneSets).where(and(eq(tuneSets.id, setId), eq(tuneSets.userId, userId))).for("update");
  if (!set) throw new SetError("Set not found");
  return set;
}

async function ownTunes(tx: Transaction, userId: string, tuneIds: string[]) {
  if (tuneIds.length < 2 || tuneIds.length > 100 || new Set(tuneIds).size !== tuneIds.length) throw new SetError("Choose 2–100 different tunes for a set");
  const tunes = await tx.select({ id: savedTunes.id, title: savedTunes.title }).from(savedTunes).where(and(eq(savedTunes.userId, userId), inArray(savedTunes.id, tuneIds)));
  if (tunes.length !== tuneIds.length) throw new SetError("Some tunes are not in your library");
  return tuneIds.map((id) => tunes.find((tune) => tune.id === id)!);
}

function setNaming(name: string | undefined, tunes: { title: string }[]) {
  const custom = name?.trim();
  if (custom && custom.length > 80) throw new SetError("Custom set names can have up to 80 characters");
  return { name: custom || defaultSetName(tunes), autoName: !custom };
}

async function reorderEntries(tx: Transaction, ids: string[]) {
  for (const [position, id] of ids.entries()) await tx.update(bookEntries).set({ position }).where(eq(bookEntries.id, id));
}

export async function groupTunes(userId: string, bookId: string, name: string | undefined, entryIds: string[]) {
  return db.transaction(async (tx) => {
    const entries = await lockBook(tx, userId, bookId);
    const selected = entryIds.map((id) => entries.find((entry) => entry.id === id));
    if (selected.some((entry) => !entry?.tuneId || entry.setId)) throw new SetError("Choose individual tunes from this tunebook");
    const tuneIds = selected.map((entry) => entry!.tuneId!);
    const tunes = await ownTunes(tx, userId, tuneIds);
    if (new Set(entryIds).size !== entryIds.length) throw new SetError("Choose each tune once");
    const [set] = await tx.insert(tuneSets).values({ userId, ...setNaming(name, tunes) }).returning();
    await tx.insert(setTunes).values(tuneIds.map((tuneId, position) => ({ setId: set.id, tuneId, position })));
    const selectedIds = new Set(entryIds);
    const first = entries.findIndex((entry) => selectedIds.has(entry.id));
    await tx.delete(bookEntries).where(inArray(bookEntries.id, entryIds));
    const [placement] = await tx.insert(bookEntries).values({ bookId, setId: set.id, position: first }).returning();
    const ordered = entries.flatMap((entry, index) => index === first ? [placement.id] : selectedIds.has(entry.id) ? [] : [entry.id]);
    await reorderEntries(tx, ordered);
    return set.id;
  });
}

export async function addSet(userId: string, bookId: string, setId: string) {
  return db.transaction(async (tx) => {
    const entries = await lockBook(tx, userId, bookId);
    await ownSet(tx, userId, setId);
    if (entries.some((entry) => entry.setId === setId)) throw new SetError("This set is already in the tunebook");
    const members = await tx.select().from(setTunes).where(eq(setTunes.setId, setId));
    await ownTunes(tx, userId, members.map((member) => member.tuneId));
    // Existing individual tunes become part of the inserted set rather than being duplicated.
    const memberIds = new Set(members.map((member) => member.tuneId));
    const singles = entries.filter((entry) => entry.tuneId && memberIds.has(entry.tuneId));
    if (singles.length) await tx.delete(bookEntries).where(inArray(bookEntries.id, singles.map((entry) => entry.id)));
    await tx.insert(bookEntries).values({ bookId, setId, position: (entries.at(-1)?.position ?? -1) + 1 });
  });
}

export async function editSet(userId: string, setId: string, name: string | undefined, tuneIds: string[]) {
  return db.transaction(async (tx) => {
    await ownSet(tx, userId, setId);
    const tunes = await ownTunes(tx, userId, tuneIds);
    await tx.update(tuneSets).set(setNaming(name, tunes)).where(eq(tuneSets.id, setId));
    await tx.delete(setTunes).where(eq(setTunes.setId, setId));
    await tx.insert(setTunes).values(tuneIds.map((tuneId, position) => ({ setId, tuneId, position })));
  });
}

export async function moveSetTune(userId: string, setId: string, tuneId: string, direction: "up" | "down") {
  return db.transaction(async (tx) => {
    await ownSet(tx, userId, setId);
    const members = await tx.select().from(setTunes).where(eq(setTunes.setId, setId)).orderBy(asc(setTunes.position));
    const index = members.findIndex((member) => member.tuneId === tuneId), next = index + (direction === "up" ? -1 : 1);
    if (index < 0) throw new SetError("Tune not found in this set");
    if (next < 0 || next >= members.length) return;
    [members[index], members[next]] = [members[next], members[index]];
    for (const [position, member] of members.entries()) await tx.update(setTunes).set({ position }).where(and(eq(setTunes.setId, setId), eq(setTunes.tuneId, member.tuneId)));
  });
}

export async function changeEntry(userId: string, bookId: string, entryId: string, operation: "up" | "down" | "remove" | "ungroup") {
  return db.transaction(async (tx) => {
    const entries = await lockBook(tx, userId, bookId);
    const index = entries.findIndex((entry) => entry.id === entryId), entry = entries[index];
    if (!entry) throw new SetError("Tunebook item not found");
    if (operation === "remove") {
      await tx.delete(bookEntries).where(eq(bookEntries.id, entryId));
    } else if (operation === "ungroup") {
      if (!entry.setId) throw new SetError("Choose a set to ungroup");
      await ownSet(tx, userId, entry.setId);
      const members = await tx.select().from(setTunes).where(eq(setTunes.setId, entry.setId)).orderBy(asc(setTunes.position));
      const replacements = members.length ? await tx.insert(bookEntries).values(members.map((member) => ({ bookId, tuneId: member.tuneId, position: index }))).returning() : [];
      await tx.delete(bookEntries).where(eq(bookEntries.id, entryId));
      await reorderEntries(tx, entries.flatMap((item) => item.id === entryId ? replacements.map((item) => item.id) : [item.id]));
    } else {
      const next = index + (operation === "up" ? -1 : 1);
      if (next < 0 || next >= entries.length) return;
      [entries[index], entries[next]] = [entries[next], entries[index]];
      await reorderEntries(tx, entries.map((item) => item.id));
    }
  });
}

export async function deleteSet(userId: string, setId: string) {
  return db.transaction(async (tx) => {
    // Match addSet's book-then-set lock order, including concurrent new placements.
    await tx.select({ id: tunebooks.id }).from(tunebooks).where(eq(tunebooks.userId, userId)).orderBy(asc(tunebooks.id)).for("update");
    await ownSet(tx, userId, setId);
    const placements = await tx.select().from(bookEntries).where(eq(bookEntries.setId, setId));
    const members = await tx.select().from(setTunes).where(eq(setTunes.setId, setId)).orderBy(asc(setTunes.position));
    for (const placement of placements) {
      const entries = await tx.select().from(bookEntries).where(eq(bookEntries.bookId, placement.bookId)).orderBy(asc(bookEntries.position), asc(bookEntries.id));
      const expanded = members.length ? await tx.insert(bookEntries).values(members.map((member) => ({ bookId: placement.bookId, tuneId: member.tuneId, position: placement.position }))).returning() : [];
      await tx.delete(bookEntries).where(eq(bookEntries.id, placement.id));
      await reorderEntries(tx, entries.flatMap((entry) => entry.id === placement.id ? expanded.map((entry) => entry.id) : [entry.id]));
    }
    await tx.delete(tuneSets).where(eq(tuneSets.id, setId));
  });
}

// Count distinct reusable sets, not how many tunebooks happen to contain each set.
export async function getOftenPlayedWith(userId: string, tuneId: number) {
  return db.execute(sql`
    SELECT other.tune_id AS "tuneId", count(DISTINCT membership.set_id)::integer AS "setCount"
    FROM set_tunes membership
    JOIN saved_tunes source ON source.id = membership.tune_id
    JOIN tune_sets sets ON sets.id = membership.set_id AND sets.user_id = ${userId}
    JOIN set_tunes paired ON paired.set_id = membership.set_id
    JOIN saved_tunes other ON other.id = paired.tune_id
    WHERE source.tune_id = ${tuneId} AND other.tune_id <> ${tuneId}
    GROUP BY other.tune_id ORDER BY "setCount" DESC, other.tune_id
  `);
}
