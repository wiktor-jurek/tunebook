import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { createRecording, RecordingError } from "@/lib/recordings";

const input = z.object({ name: z.string().trim().min(1).max(80), mime: z.string().max(80), recordedAt: z.iso.datetime() }).strict();

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid recording" }, { status: 400 });
  try {
    return NextResponse.json(await createRecording(user.id, { ...parsed.data, recordedAt: new Date(parsed.data.recordedAt) }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof RecordingError ? error.message : "Could not start the upload" }, { status: error instanceof RecordingError ? error.status : 500 });
  }
}
