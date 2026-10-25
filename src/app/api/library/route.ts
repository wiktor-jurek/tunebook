import { and, asc, eq, exists } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookEntries, savedTunes, tunebooks } from "@/db/schema";
import { currentUser } from "@/lib/session";
import * as library from "@/lib/library-actions";
import { LibraryError, validId } from "@/lib/library-actions";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const tuneId = validId(new URL(request.url).searchParams.get("tuneId"));
    const [tune] = await db.select({ id: savedTunes.id }).from(savedTunes).where(and(eq(savedTunes.userId, user.id), eq(savedTunes.id, tuneId))).limit(1);
    if (!tune) return NextResponse.json({ error: "Tune not found" }, { status: 404 });
    const books = await db.select({ id: tunebooks.id, name: tunebooks.name, emoji: tunebooks.emoji,
      inBook: exists(db.select({ id: bookEntries.id }).from(bookEntries).where(and(eq(bookEntries.bookId, tunebooks.id), eq(bookEntries.tuneId, tuneId)))) })
      .from(tunebooks)
      .where(eq(tunebooks.userId, user.id)).orderBy(asc(tunebooks.name));
    return NextResponse.json({ books });
  } catch (error) {
    return NextResponse.json({ error: error instanceof LibraryError ? error.message : "Could not load tunebooks" }, { status: error instanceof LibraryError ? 400 : 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  try {
    const userId = user.id;
    switch (input.operation) {
      case "createFolder": await library.createFolder(userId, { name: input.name, parentId: input.parentId }); break;
      case "renameFolder": await library.renameFolder(userId, input.folderId, input.name); break;
      case "moveFolder": await library.moveFolder(userId, { folderId: input.folderId, parentId: input.parentId }); break;
      case "deleteFolder": await library.deleteFolder(userId, input.folderId); break;
      case "createBook": await library.createBook(userId, { name: input.name, folderId: input.folderId, emoji: input.emoji }); break;
      case "renameBook": await library.renameBook(userId, { bookId: input.bookId, name: input.name, ...("emoji" in input ? { emoji: input.emoji } : {}) }); break;
      case "setBookEmoji": await library.setBookEmoji(userId, input.bookId, input.emoji); break;
      case "moveBook": await library.moveBook(userId, { bookId: input.bookId, folderId: input.folderId }); break;
      case "deleteBook": await library.deleteBook(userId, input.bookId); break;
      case "addToBook": await library.addToBook(userId, { bookId: input.bookId, tuneId: input.tuneId }); break;
      case "removeFromBook": await library.removeFromBook(userId, { bookId: input.bookId, tuneId: input.tuneId }); break;
      case "moveTune": await library.moveTune(userId, { bookId: input.bookId, tuneId: input.tuneId, direction: input.direction }); break;
      case "deleteSavedTune": await library.deleteSavedTune(userId, input.tuneId); break;
      default: throw new LibraryError("Unknown operation");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof LibraryError ? error.message : "Request failed" }, { status: error instanceof LibraryError ? 400 : 500 });
  }
}
