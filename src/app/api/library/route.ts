import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookTunes, folders, savedTunes, tunebooks } from "@/db/schema";
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
        await db.insert(tunebooks).values({ userId, folderId, name: name(input.name) });
        break;
      }
      case "renameBook": {
        const result = await db.update(tunebooks).set({ name: name(input.name) }).where(and(eq(tunebooks.userId, userId), eq(tunebooks.id, id(input.bookId)))).returning({ id: tunebooks.id });
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
        const [last] = await db.select({ position: bookTunes.position }).from(bookTunes).where(eq(bookTunes.bookId, bookId)).orderBy(sql`${bookTunes.position} desc`).limit(1);
        await db.insert(bookTunes).values({ bookId, tuneId, position: (last?.position ?? -1) + 1 }).onConflictDoNothing();
        break;
      }
      case "removeFromBook": {
        const bookId = id(input.bookId), tuneId = id(input.tuneId);
        await ownBook(bookId);
        await db.delete(bookTunes).where(and(eq(bookTunes.bookId, bookId), eq(bookTunes.tuneId, tuneId)));
        break;
      }
      case "moveTune": {
        const bookId = id(input.bookId), tuneId = id(input.tuneId), direction = input.direction;
        if (direction !== "up" && direction !== "down") throw new ClientError("Invalid direction");
        await ownBook(bookId);
        await db.transaction(async (tx) => {
          const rows = await tx.select().from(bookTunes).where(eq(bookTunes.bookId, bookId)).orderBy(asc(bookTunes.position));
          const index = rows.findIndex((row) => row.tuneId === tuneId);
          const next = index + (direction === "up" ? -1 : 1);
          if (index < 0 || next < 0 || next >= rows.length) return;
          await tx.update(bookTunes).set({ position: rows[next].position }).where(and(eq(bookTunes.bookId, bookId), eq(bookTunes.tuneId, tuneId)));
          await tx.update(bookTunes).set({ position: rows[index].position }).where(and(eq(bookTunes.bookId, bookId), eq(bookTunes.tuneId, rows[next].tuneId)));
        });
        break;
      }
      case "deleteSavedTune": {
        const result = await db.delete(savedTunes).where(and(eq(savedTunes.userId, userId), eq(savedTunes.id, id(input.tuneId)))).returning({ id: savedTunes.id });
        if (!result.length) throw new ClientError("Tune not found");
        break;
      }
      default: throw new ClientError("Unknown operation");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ClientError ? error.message : "Request failed" }, { status: error instanceof ClientError ? 400 : 500 });
  }
}
