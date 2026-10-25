import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookShares, tunebooks } from "@/db/schema";
import { isBookId } from "@/lib/library";
import { sendEmail } from "@/lib/email";

export class SharingError extends Error {}
type Owner = { id: string; name: string; email: string };

export async function ownedBook(userId: string, bookId: string) {
  const [book] = isBookId(bookId) ? await db.select().from(tunebooks)
    .where(and(eq(tunebooks.id, bookId), eq(tunebooks.userId, userId))).limit(1) : [];
  return book ?? null;
}

async function requireOwnedBook(userId: string, bookId: string) {
  const book = await ownedBook(userId, bookId);
  if (!book) throw new SharingError("Tunebook not found");
  return book;
}

export async function getSharing(userId: string, bookId: string) {
  const book = await requireOwnedBook(userId, bookId);
  const shares = await db.select({ email: bookShares.email }).from(bookShares)
    .where(eq(bookShares.bookId, book.id)).orderBy(asc(bookShares.email));
  return { linkVisible: book.linkVisible, shares };
}

export async function setLinkVisible(userId: string, bookId: string, linkVisible: boolean) {
  const book = await requireOwnedBook(userId, bookId);
  await db.update(tunebooks).set({ linkVisible }).where(eq(tunebooks.id, book.id));
}

export async function removeShare(userId: string, bookId: string, email: string) {
  const book = await requireOwnedBook(userId, bookId);
  await db.delete(bookShares).where(and(eq(bookShares.bookId, book.id), eq(bookShares.email, email.toLowerCase())));
}

// Access is granted even when the invitation email fails; the warning tells the owner to send the link.
export async function inviteToBook(owner: Owner, bookId: string, email: string, appUrl: string) {
  const book = await requireOwnedBook(owner.id, bookId);
  const invitee = email.toLowerCase();
  if (invitee === owner.email.toLowerCase()) throw new SharingError("You already own this tunebook");
  const inserted = await db.insert(bookShares).values({ bookId: book.id, email: invitee })
    .onConflictDoNothing().returning({ email: bookShares.email });
  if (!inserted.length) return { invited: false, warning: undefined };
  const url = new URL(`/books/${book.id}`, appUrl).href;
  try {
    await sendEmail(invitee, `${owner.name} shared a tunebook with you`,
      `${owner.name} shared ${book.name} with you.\n\nOpen the tunebook: ${url}\n\nSign in or create an account using ${invitee}. Once your email is verified, the tunebook will appear under Shared with me. You have view-only access.`);
    return { invited: true, warning: undefined };
  } catch {
    return { invited: true, warning: "Access granted, but the invitation email could not be sent. Copy the link and send it to them." };
  }
}
