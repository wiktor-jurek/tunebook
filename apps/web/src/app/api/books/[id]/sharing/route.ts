import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { getSharing, inviteToBook, ownedBook, removeShare, setLinkVisible, SharingError } from "@/lib/sharing";

type Context = { params: Promise<{ id: string }> };
const change = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("invite"), email: z.email().max(254).transform((email) => email.toLowerCase()) }),
  z.object({ operation: z.literal("remove"), email: z.email().max(254).transform((email) => email.toLowerCase()) }),
  z.object({ operation: z.literal("visibility"), linkVisible: z.boolean() }),
]);

async function ownedBookAccess(context: Context) {
  const user = await currentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  const { id } = await context.params;
  const book = await ownedBook(user.id, id);
  if (!book) return { response: NextResponse.json({ error: "Tunebook not found" }, { status: 404 }) };
  return { book, user };
}

export async function GET(_request: Request, context: Context) {
  try {
    const access = await ownedBookAccess(context);
    if (access.response) return access.response;
    return NextResponse.json(await getSharing(access.user.id, access.book.id));
  } catch {
    return NextResponse.json({ error: "Could not load sharing settings" }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const access = await ownedBookAccess(context);
    if (access.response) return access.response;
    const parsed = change.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a valid sharing setting or email address" }, { status: 400 });
    const input = parsed.data;
    let warning: string | undefined;
    if (input.operation === "visibility") await setLinkVisible(access.user.id, access.book.id, input.linkVisible);
    else if (input.operation === "remove") await removeShare(access.user.id, access.book.id, input.email);
    else ({ warning } = await inviteToBook(access.user, access.book.id, input.email, process.env.BETTER_AUTH_URL || request.url));
    return NextResponse.json({ ok: true, warning });
  } catch (error) {
    if (error instanceof SharingError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not update sharing settings" }, { status: 500 });
  }
}
