import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookEntries, folders, savedTunes, setTunes, tunebooks } from "@/db/schema";
import { currentUser } from "@/lib/session";

class ClientError extends Error {}

function name(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new ClientError("Name must be 1–80 characters");
  return value.trim();
}
function id(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) throw new ClientError("Invalid ID");
  return value;
}
function optionalId(value: unknown) { return value === null || value === "" || value === undefined ? null : id(value); }
function bookEmoji(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 32 || [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length !== 1) throw new ClientError("Choose one emoji");
  return value;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const tuneId = id(new URL(request.url).searchParams.get("tuneId"));
    const [tune] = await db.select({ id: savedTunes.id }).from(savedTunes).where(and(eq(savedTunes.userId, user.id), eq(savedTunes.id, tuneId))).limit(1);
    if (!tune) return NextResponse.json({ error: "Tune not found" }, { status: 404 });
    const books = await db.select({ id: tunebooks.id, name: tunebooks.name, emoji: tunebooks.emoji,
      inBook: exists(db.select({ id: bookEntries.id }).from(bookEntries).where(and(eq(bookEntries.bookId, tunebooks.id), eq(bookEntries.tuneId, tuneId)))) })
      .from(tunebooks)
      .where(eq(tunebooks.userId, user.id)).orderBy(asc(tunebooks.name));
    return NextResponse.json({ books });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ClientError ? error.message : "Could not load tunebooks" }, { status: error instanceof ClientError ? 400 : 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  try {
    const userId = user.id;
    const folderExists = async (folderId: string | null) => {
      if (!folderId) return;
      const [row] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.userId, userId), eq(folders.id, folderId))).limit(1);
      if (!row) throw new ClientError("Folder not found");
    };
    const ownBook = async (bookId: string) => {
      const [row] = await db.select({ id: tunebooks.id }).from(tunebooks).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, bookId))).limit(1);
      if (!row) throw new ClientError("Tunebook not found");
    };
    const ownTune = async (tuneId: string) => {
      const [row] = await db.select({ id: savedTunes.id }).from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, tuneId))).limit(1);
      if (!row) throw new ClientError("Tune not found");
    };
    switch (input.operation) {
      case "createFolder": {
        const parentId = optionalId(input.parentId);
        await folderExists(parentId);
        await db.insert(folders).values({ userId, parentId, name: name(input.name) });
        break;
      }
      case "renameFolder": {
        const result = await db.update(folders).set({ name: name(input.name) }).where(and(eq(folders.userId, userId), eq(folders.id, id(input.folderId)))).returning({ id: folders.id });
        if (!result.length) throw new ClientError("Folder not found");
        break;
      }
      case "moveFolder": {
        const folderId = id(input.folderId), parentId = optionalId(input.parentId);
        await folderExists(folderId); await folderExists(parentId);
        if (parentId === folderId) throw new ClientError("A folder cannot contain itself");
        const rows = await db.select({ id: folders.id, parentId: folders.parentId }).from(folders).where(eq(folders.userId, userId));
        const byId = new Map(rows.map((row) => [row.id, row.parentId]));
        let cursor = parentId;
        while (cursor) {
          if (cursor === folderId) throw new ClientError("A folder cannot move into its descendant");
          cursor = byId.get(cursor) ?? null;
        }
        await db.update(folders).set({ parentId }).where(and(eq(folders.userId, userId), eq(folders.id, folderId)));
        break;
      }
      case "deleteFolder": {
        const folderId = id(input.folderId);
        await folderExists(folderId);
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
        break;
      }
      case "createBook": {
        const folderId = optionalId(input.folderId);
        await folderExists(folderId);
        await db.insert(tunebooks).values({ userId, folderId, name: name(input.name), emoji: bookEmoji(input.emoji ?? null) });
        break;
      }
      case "renameBook": {
        const updates = { name: name(input.name), ...("emoji" in input ? { emoji: bookEmoji(input.emoji) } : {}) };
        const result = await db.update(tunebooks).set(updates).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, id(input.bookId)))).returning({ id: tunebooks.id });
        if (!result.length) throw new ClientError("Tunebook not found");
        break;
      }
      case "setBookEmoji": {
        const result = await db.update(tunebooks).set({ emoji: bookEmoji(input.emoji) })
          .where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, id(input.bookId)))).returning({ id: tunebooks.id });
        if (!result.length) throw new ClientError("Tunebook not found");
        break;
      }
      case "moveBook": {
        const bookId = id(input.bookId), folderId = optionalId(input.folderId);
        await ownBook(bookId); await folderExists(folderId);
        await db.update(tunebooks).set({ folderId }).where(eq(tunebooks.id, bookId));
        break;
      }
      case "deleteBook": {
        const result = await db.delete(tunebooks).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, id(input.bookId)))).returning({ id: tunebooks.id });
        if (!result.length) throw new ClientError("Tunebook not found");
        break;
      }
      case "addToBook": {
        const bookId = id(input.bookId), tuneId = id(input.tuneId);
        await ownBook(bookId); await ownTune(tuneId);
        await db.transaction(async (tx) => {
          await tx.select({ id: tunebooks.id }).from(tunebooks).where(eq(tunebooks.id, bookId)).for("update");
          const [existing] = await tx.select({ id: bookEntries.id }).from(bookEntries).where(and(eq(bookEntries.bookId, bookId), eq(bookEntries.tuneId, tuneId))).limit(1);
          if (existing) return;
          const [last] = await tx.select({ position: bookEntries.position }).from(bookEntries).where(eq(bookEntries.bookId, bookId)).orderBy(sql`${bookEntries.position} desc`).limit(1);
          await tx.insert(bookEntries).values({ bookId, tuneId, position: (last?.position ?? -1) + 1 });
        });
        break;
      }
      case "removeFromBook": {
        const bookId = id(input.bookId), tuneId = id(input.tuneId);
        await ownBook(bookId);
        await db.delete(bookEntries).where(and(eq(bookEntries.bookId, bookId), eq(bookEntries.tuneId, tuneId)));
        break;
      }
      case "moveTune": {
        const bookId = id(input.bookId), tuneId = id(input.tuneId), direction = input.direction;
        if (direction !== "up" && direction !== "down") throw new ClientError("Invalid direction");
        await ownBook(bookId);
        await db.transaction(async (tx) => {
          await tx.select({ id: tunebooks.id }).from(tunebooks).where(eq(tunebooks.id, bookId)).for("update");
          const rows = await tx.select().from(bookEntries).where(eq(bookEntries.bookId, bookId)).orderBy(asc(bookEntries.position));
          const index = rows.findIndex((row) => row.tuneId === tuneId);
          const next = index + (direction === "up" ? -1 : 1);
          if (index < 0 || next < 0 || next >= rows.length) return;
          await tx.update(bookEntries).set({ position: rows[next].position }).where(eq(bookEntries.id, rows[index].id));
          await tx.update(bookEntries).set({ position: rows[index].position }).where(eq(bookEntries.id, rows[next].id));
        });
        break;
      }
      case "deleteSavedTune": {
        const tuneId = id(input.tuneId);
        await db.transaction(async (tx) => {
          const [tune] = await tx.select({ id: savedTunes.id }).from(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, tuneId))).for("update");
          if (!tune) throw new ClientError("Tune not found");
          const [membership] = await tx.select({ setId: setTunes.setId }).from(setTunes).where(eq(setTunes.tuneId, tuneId)).limit(1);
          if (membership) throw new ClientError("This tune belongs to a set. Edit the set to remove it before deleting the tune.");
          await tx.delete(savedTunes).where(eq(savedTunes.id, tuneId));
        });
        break;
      }
      default: throw new ClientError("Unknown operation");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ClientError ? error.message : "Request failed" }, { status: error instanceof ClientError ? 400 : 500 });
  }
}
