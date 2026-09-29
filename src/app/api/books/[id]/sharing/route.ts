import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { bookShares, tunebooks } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { isBookId } from "@/lib/library";
import { sendEmail } from "@/lib/email";

type Context = { params: Promise<{ id: string }> };
const change = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("invite"), email: z.email().max(254).transform((email) => email.toLowerCase()) }),
  z.object({ operation: z.literal("remove"), email: z.email().max(254).transform((email) => email.toLowerCase()) }),
  z.object({ operation: z.literal("visibility"), linkVisible: z.boolean() }),
]);

async function ownedBook(context: Context) {
  const user = await currentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  const { id } = await context.params;
  const [book] = isBookId(id) ? await db.select().from(tunebooks)
    .where(and(eq(tunebooks.id, id), eq(tunebooks.userId, user.id))).limit(1) : [];
  if (!book) return { response: NextResponse.json({ error: "Tunebook not found" }, { status: 404 }) };
  return { book, user };
}

export async function GET(_request: Request, context: Context) {
  try {
    const access = await ownedBook(context);
    if (access.response) return access.response;
    const shares = await db.select({ email: bookShares.email }).from(bookShares)
      .where(eq(bookShares.bookId, access.book.id)).orderBy(asc(bookShares.email));
    return NextResponse.json({ linkVisible: access.book.linkVisible, shares });
  } catch {
    return NextResponse.json({ error: "Could not load sharing settings" }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const access = await ownedBook(context);
    if (access.response) return access.response;
    const parsed = change.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid sharing setting or email address" }, { status: 400 });
    const input = parsed.data;
    let warning: string | undefined;
    if (input.operation === "visibility") {
      await db.update(tunebooks).set({ linkVisible: input.linkVisible }).where(eq(tunebooks.id, access.book.id));
    } else if (input.operation === "remove") {
      await db.delete(bookShares).where(and(eq(bookShares.bookId, access.book.id), eq(bookShares.email, input.email)));
    } else {
      if (input.email === access.user.email.toLowerCase()) return NextResponse.json({ error: "You already own this tunebook" }, { status: 400 });
      const inserted = await db.insert(bookShares).values({ bookId: access.book.id, email: input.email })
        .onConflictDoNothing().returning({ email: bookShares.email });
      if (inserted.length) {
        const url = new URL(`/books/${access.book.id}`, process.env.BETTER_AUTH_URL || request.url).href;
        try {
          await sendEmail(input.email, `${access.user.name} shared a tunebook with you`,
            `${access.user.name} shared ${access.book.name} with you.\n\nOpen the tunebook: ${url}\n\nSign in or create an account using ${input.email}. Once your email is verified, the tunebook will appear under Shared with me. You have view-only access.`);
        } catch {
          warning = "Access granted, but the invitation email could not be sent. Copy the link and send it to them.";
        }
      }
    }
    return NextResponse.json({ ok: true, warning });
  } catch {
    return NextResponse.json({ error: "Could not update sharing settings" }, { status: 500 });
  }
}
