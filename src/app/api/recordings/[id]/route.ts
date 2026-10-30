import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { deleteRecording, finishRecording, RecordingError, removeRecordingTune } from "@/lib/recordings";

const tune = z.object({ tuneId: z.number().int().positive(), settingId: z.number().int().positive(), startMs: z.number().int().min(0), endMs: z.number().int().min(0) }).strict();
const input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("finish"), durationMs: z.number().int().min(0), tunes: z.array(tune).max(500) }).strict(),
  z.object({ operation: z.literal("removeTune"), entryId: z.uuid() }).strict(),
]);

const failure = (error: unknown, fallback: string) => NextResponse.json({ error: error instanceof RecordingError ? error.message : fallback }, { status: error instanceof RecordingError ? error.status : 500 });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    if (parsed.data.operation === "finish") await finishRecording(user.id, id, parsed.data);
    else await removeRecordingTune(user.id, id, parsed.data.entryId);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error, "Could not update the recording"); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try { await deleteRecording(user.id, id); return NextResponse.json({ ok: true }); } catch (error) { return failure(error, "Could not delete the recording"); }
}
