import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookEntries, folders, savedTunes, setTunes, tunebooks } from "@/db/schema";

// Messages are safe to show to people and agents.
export class LibraryError extends Error {}

export function validName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new LibraryError("Name must be 1-80 characters");
  return value.trim();
}
export function validId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) throw new LibraryError("Invalid ID");
  return value;
}
export function optionalId(value: unknown) { return value === null || value === "" || value === undefined ? null : validId(value); }
export function bookEmoji(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 32 || [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length !== 1) throw new LibraryError("Choose one emoji");
  return value;
}

async function folderExists(userId: string, folderId: string | null) {
  if (!folderId) return;
  const [row] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.userId, userId), eq(folders.id, folderId))).limit(1);
  if (!row) throw new LibraryError("Folder not found");
}
async function ownBook(userId: string, bookId: string) {
  const [row] = await db.select({ id: tunebooks.id }).from(tunebooks).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, bookId))).limit(1);
  if (!row) throw new LibraryError("Tunebook not found");
}
async function ownTune(userId: string, tuneId: string) {
  const [row] = await db.select({ id: savedTunes.id }).from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, tuneId))).limit(1);
  if (!row) throw new LibraryError("Tune not found");
}

export async function createFolder(userId: string, input: { name: unknown; parentId?: unknown }) {
  const parentId = optionalId(input.parentId);
  await folderExists(userId, parentId);
  const [folder] = await db.insert(folders).values({ userId, parentId, name: validName(input.name) }).returning({ id: folders.id });
  return folder.id;
}

export async function renameFolder(userId: string, folderId: unknown, name: unknown) {
  const result = await db.update(folders).set({ name: validName(name) }).where(and(eq(folders.userId, userId), eq(folders.id, validId(folderId)))).returning({ id: folders.id });
  if (!result.length) throw new LibraryError("Folder not found");
}

export async function moveFolder(userId: string, input: { folderId: unknown; parentId?: unknown }) {
  const folderId = validId(input.folderId), parentId = optionalId(input.parentId);
  await folderExists(userId, folderId); await folderExists(userId, parentId);
  if (parentId === folderId) throw new LibraryError("A folder cannot contain itself");
  const rows = await db.select({ id: folders.id, parentId: folders.parentId }).from(folders).where(eq(folders.userId, userId));
  const byId = new Map(rows.map((row) => [row.id, row.parentId]));
  let cursor = parentId;
  while (cursor) {
    if (cursor === folderId) throw new LibraryError("A folder cannot move into its descendant");
    cursor = byId.get(cursor) ?? null;
  }
  await db.update(folders).set({ parentId }).where(and(eq(folders.userId, userId), eq(folders.id, folderId)));
}

export async function deleteFolder(userId: string, input: unknown) {
  const folderId = validId(input);
  await folderExists(userId, folderId);
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: folders.id, parentId: folders.parentId }).from(folders).where(eq(folders.userId, userId));
    const descendants = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (row.parentId && descendants.has(row.parentId) && !descendants.has(row.id)) { descendants.add(row.id); changed = true; }
    }
    const ids = [...descendants];
    await tx.delete(tunebooks).where(and(eq(tunebooks.userId, userId), inArray(tunebooks.folderId, ids)));
    await tx.delete(folders).where(and(eq(folders.userId, userId), inArray(folders.id, ids)));
  });
}

export async function createBook(userId: string, input: { name: unknown; folderId?: unknown; emoji?: unknown }) {
  const folderId = optionalId(input.folderId);
  await folderExists(userId, folderId);
  const [book] = await db.insert(tunebooks).values({ userId, folderId, name: validName(input.name), emoji: bookEmoji(input.emoji ?? null) }).returning({ id: tunebooks.id });
  return book.id;
}

export async function renameBook(userId: string, input: { bookId: unknown; name: unknown; emoji?: unknown }) {
  const updates = { name: validName(input.name), ...("emoji" in input ? { emoji: bookEmoji(input.emoji) } : {}) };
  const result = await db.update(tunebooks).set(updates).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, validId(input.bookId)))).returning({ id: tunebooks.id });
  if (!result.length) throw new LibraryError("Tunebook not found");
}

export async function setBookEmoji(userId: string, bookId: unknown, emoji: unknown) {
  const result = await db.update(tunebooks).set({ emoji: bookEmoji(emoji) })
    .where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, validId(bookId)))).returning({ id: tunebooks.id });
  if (!result.length) throw new LibraryError("Tunebook not found");
}

export async function moveBook(userId: string, input: { bookId: unknown; folderId?: unknown }) {
  const bookId = validId(input.bookId), folderId = optionalId(input.folderId);
  await ownBook(userId, bookId); await folderExists(userId, folderId);
  await db.update(tunebooks).set({ folderId }).where(eq(tunebooks.id, bookId));
}

export async function deleteBook(userId: string, bookId: unknown) {
  const result = await db.delete(tunebooks).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, validId(bookId)))).returning({ id: tunebooks.id });
  if (!result.length) throw new LibraryError("Tunebook not found");
}

export async function addToBook(userId: string, input: { bookId: unknown; tuneId: unknown }) {
  const bookId = validId(input.bookId), tuneId = validId(input.tuneId);
  await ownBook(userId, bookId); await ownTune(userId, tuneId);
  await db.transaction(async (tx) => {
    await tx.select({ id: tunebooks.id }).from(tunebooks).where(eq(tunebooks.id, bookId)).for("update");
    const [existing] = await tx.select({ id: bookEntries.id }).from(bookEntries).where(and(eq(bookEntries.bookId, bookId), eq(bookEntries.tuneId, tuneId))).limit(1);
    if (existing) return;
    const [last] = await tx.select({ position: bookEntries.position }).from(bookEntries).where(eq(bookEntries.bookId, bookId)).orderBy(sql`${bookEntries.position} desc`).limit(1);
    await tx.insert(bookEntries).values({ bookId, tuneId, position: (last?.position ?? -1) + 1 });
  });
}

export async function removeFromBook(userId: string, input: { bookId: unknown; tuneId: unknown }) {
  const bookId = validId(input.bookId), tuneId = validId(input.tuneId);
  await ownBook(userId, bookId);
  await db.delete(bookEntries).where(and(eq(bookEntries.bookId, bookId), eq(bookEntries.tuneId, tuneId)));
}

export async function moveTune(userId: string, input: { bookId: unknown; tuneId: unknown; direction: unknown }) {
  const bookId = validId(input.bookId), tuneId = validId(input.tuneId), direction = input.direction;
  if (direction !== "up" && direction !== "down") throw new LibraryError("Invalid direction");
  await ownBook(userId, bookId);
  await db.transaction(async (tx) => {
    await tx.select({ id: tunebooks.id }).from(tunebooks).where(eq(tunebooks.id, bookId)).for("update");
    const rows = await tx.select().from(bookEntries).where(eq(bookEntries.bookId, bookId)).orderBy(asc(bookEntries.position));
    const index = rows.findIndex((row) => row.tuneId === tuneId);
    const next = index + (direction === "up" ? -1 : 1);
    if (index < 0 || next < 0 || next >= rows.length) return;
    await tx.update(bookEntries).set({ position: rows[next].position }).where(eq(bookEntries.id, rows[index].id));
    await tx.update(bookEntries).set({ position: rows[index].position }).where(eq(bookEntries.id, rows[next].id));
  });
}

export async function deleteSavedTune(userId: string, input: unknown) {
  const tuneId = validId(input);
  await db.transaction(async (tx) => {
    const [tune] = await tx.select({ id: savedTunes.id }).from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, tuneId))).for("update");
    if (!tune) throw new LibraryError("Tune not found");
    const [membership] = await tx.select({ setId: setTunes.setId }).from(setTunes).where(eq(setTunes.tuneId, tuneId)).limit(1);
    if (membership) throw new LibraryError("This tune belongs to a set. Edit the set to remove it before deleting the tune.");
    await tx.delete(savedTunes).where(eq(savedTunes.id, tuneId));
  });
}
