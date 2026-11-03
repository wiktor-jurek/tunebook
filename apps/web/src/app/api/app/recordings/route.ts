import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { listRecordings, recordingTitle } from "@/lib/recordings";

// The native apps' Recordings tab: your uploaded session recordings, newest first, each with its day as its title,
// its length, how many tunes were named and the first few of them.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const recordings = await listRecordings(user.id);
    return NextResponse.json({ recordings: recordings.map((r) => ({ ...r, title: recordingTitle(r.recordedAt), recordedAt: r.recordedAt.toISOString() })) });
  } catch {
    return NextResponse.json({ error: "Could not load your recordings" }, { status: 500 });
  }
}
