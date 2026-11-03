import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getBook, isBookId } from "@/lib/library";
import { getPlayalongsBySetting } from "@/lib/playalongs";
import { getDefaultSound } from "@/lib/preferences";
import { DEFAULT_SOUND } from "@/lib/sounds";

// A tunebook for the native apps, as the phone's web book page reads it: its tunes and sets in playing order (with
// where each tune stands for you, and which are often played at its session), the play-alongs for every setting, and
// your sound. Who may open it is getBook's rule: the owner, people it is shared with, or anyone if its link is public.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isBookId(id)) return NextResponse.json({ error: "Tunebook not found" }, { status: 404 });
  const user = await currentUser();
  try {
    const data = await getBook(user?.id ?? null, id);
    if (!data) return NextResponse.json({ error: user ? "Tunebook not found" : "Sign in required" }, { status: user ? 404 : 401 });
    const [playalongs, defaultSound] = await Promise.all([
      getPlayalongsBySetting(data.tunes.map((row) => row.tune.settingId)),
      user ? getDefaultSound(user.id) : DEFAULT_SOUND,
    ]);
    const tune = (t: (typeof data.tunes)[number]["tune"]) => ({ id: t.id, tuneId: t.tuneId, settingId: t.settingId, title: t.title, emoji: t.emoji,
      kind: t.kind, meter: t.meter, mode: t.mode, abc: t.abc, practice: t.practice, oftenPlayed: t.oftenPlayed });
    return NextResponse.json({
      book: { id: data.book.id, name: data.book.name, emoji: data.book.emoji, isOwner: user?.id === data.book.userId },
      sections: data.sections.map((section) => section.kind === "tune"
        ? { kind: "tune", entryId: section.entryId, tune: tune(section.tune) }
        : { kind: "set", entryId: section.entryId, setId: section.setId, name: section.name, tunes: section.tunes.map(tune) }),
      playalongs,
      defaultSound,
    });
  } catch {
    return NextResponse.json({ error: "Could not load the tunebook" }, { status: 500 });
  }
}
