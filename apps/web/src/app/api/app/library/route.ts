import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getLibrary, getTuneBooks } from "@/lib/library";

// The native apps' home screen in one request: who is signed in, every saved tune with where it stands, and the
// tunebooks (with the tunes in each, for grouping by tunebook) and those shared with you. Signed in with a bearer token.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const [{ tunes, sharedBooks }, books] = await Promise.all([getLibrary(user.id), getTuneBooks(user.id)]);
    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      tunes: tunes.map((tune) => ({
        id: tune.id, tuneId: tune.tuneId, settingId: tune.settingId, title: tune.title, emoji: tune.emoji,
        kind: tune.kind, meter: tune.meter, mode: tune.mode, abc: tune.abc, practice: tune.practice,
      })),
      books,
      sharedBooks,
    });
  } catch {
    return NextResponse.json({ error: "Could not load your library" }, { status: 500 });
  }
}
