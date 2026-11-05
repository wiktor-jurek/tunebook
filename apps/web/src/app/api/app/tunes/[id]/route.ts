import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { getSavedTune } from "@/lib/library";
import { getPlayalongs } from "@/lib/playalongs";
import { getDefaultSound } from "@/lib/preferences";
import { recordingTitle, tuneHeard } from "@/lib/recordings";

// One of your tunes for the native apps' tune page: the tune with where it stands, its play-along recordings (signed
// URLs, as the web player gets them), the sound you play scores with, and where you heard it in your recordings.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Tune not found" }, { status: 404 });
  try {
    const [tune, defaultSound] = await Promise.all([getSavedTune(user.id, id), getDefaultSound(user.id)]);
    if (!tune) return NextResponse.json({ error: "Tune not found" }, { status: 404 });
    const [playalongs, heard] = await Promise.all([getPlayalongs(tune.settingId), tuneHeard(user.id, tune.tuneId)]);
    return NextResponse.json({
      tune: { id: tune.id, tuneId: tune.tuneId, settingId: tune.settingId, title: tune.title, emoji: tune.emoji, kind: tune.kind,
        meter: tune.meter, mode: tune.mode, abc: tune.abc, practice: tune.practice },
      playalongs,
      defaultSound,
      heard: heard.map((h) => ({ ...h, title: recordingTitle(h.recordedAt), recordedAt: h.recordedAt.toISOString() })),
    });
  } catch {
    return NextResponse.json({ error: "Could not load the tune" }, { status: 500 });
  }
}
