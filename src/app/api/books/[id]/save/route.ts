import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { bookEntries, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { getBook } from "@/lib/library";

const save = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("book") }),
  z.object({ operation: z.literal("tune"), tuneId: z.uuid() }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const parsed = save.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { id } = await context.params;
    const data = await getBook(user.id, id);
    if (!data) return NextResponse.json({ error: "Tunebook not found" }, { status: 404 });
    const input = parsed.data;
    const selected = input.operation === "tune" ? data.tunes.filter(({ tune }) => tune.id === input.tuneId) : data.tunes;
    if (input.operation === "tune" && !selected.length) return NextResponse.json({ error: "Tune not found in this tunebook" }, { status: 404 });
    const result = await db.transaction(async (tx) => {
      const ids = new Map<string, string>();
      for (const { tune } of selected) {
        if (ids.has(tune.id)) continue;
        const [saved] = await tx.insert(savedTunes).values({ userId: user.id, settingId: tune.settingId, tuneId: tune.tuneId,
          title: tune.title, kind: tune.kind, meter: tune.meter, mode: tune.mode, abc: tune.abc,
          contributor: tune.contributor, composer: tune.composer, sourceUrl: tune.sourceUrl })
          .onConflictDoUpdate({ target: [savedTunes.userId, savedTunes.settingId], set: { settingId: savedTunes.settingId } })
          .returning({ id: savedTunes.id });
        ids.set(tune.id, saved.id);
      }
      if (input.operation === "tune") return { tuneId: ids.get(input.tuneId) };
      const [copy] = await tx.insert(tunebooks).values({ userId: user.id, name: data.book.name, emoji: data.book.emoji }).returning({ id: tunebooks.id });
      for (const [position, section] of data.sections.entries()) {
        if (section.kind === "tune") await tx.insert(bookEntries).values({ bookId: copy.id, tuneId: ids.get(section.tune.id)!, position });
        else {
          const [set] = await tx.insert(tuneSets).values({ userId: user.id, name: section.name }).returning({ id: tuneSets.id });
          if (section.tunes.length) await tx.insert(setTunes).values(section.tunes.map((tune, position) => ({ setId: set.id, tuneId: ids.get(tune.id)!, position })));
          await tx.insert(bookEntries).values({ bookId: copy.id, setId: set.id, position });
        }
      }
      return { bookId: copy.id };
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not save to your library" }, { status: 500 });
  }
}
