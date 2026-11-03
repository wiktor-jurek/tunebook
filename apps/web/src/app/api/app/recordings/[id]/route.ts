import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { getRecording, recordingTitle } from "@/lib/recordings";

// One recording for the native apps' player: its audio (a signed URL) and its setlist, each tune with where it stands
// for you and whether it is in your library.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  try {
    const recording = await getRecording(user.id, id);
    if (!recording) return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    // Only what the player needs: never the storage key or the owner.
    return NextResponse.json({ recording: { id: recording.id, name: recording.name, title: recordingTitle(recording.recordedAt),
      recordedAt: recording.recordedAt.toISOString(), durationMs: recording.durationMs, audioUrl: recording.audioUrl, tunes: recording.tunes } });
  } catch {
    return NextResponse.json({ error: "Could not load the recording" }, { status: 500 });
  }
}
