import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { isSingleEmoji } from "@/lib/emoji";
import { setTuneEmojiOverride, TuneEmojiError } from "@/lib/tune-emojis";

const input = z.object({ emoji: z.string().refine(isSingleEmoji, "Choose one emoji").nullable() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose one emoji, or reset to the suggestion" }, { status: 400 });
  try {
    await setTuneEmojiOverride(user.id, id, parsed.data.emoji);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof TuneEmojiError ? cause.message : "Could not update icon" }, { status: cause instanceof TuneEmojiError ? 404 : 500 });
  }
}
