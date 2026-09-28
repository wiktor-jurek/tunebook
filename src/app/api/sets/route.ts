import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { addSet, changeEntry, deleteSet, editSet, groupTunes, moveSetTune, SetError } from "@/lib/sets";

const name = z.string().trim().max(80).optional();
const inputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("group"), bookId: z.uuid(), name, entryIds: z.array(z.uuid()).min(2).max(100) }),
  z.object({ operation: z.literal("add"), bookId: z.uuid(), setId: z.uuid() }),
  z.object({ operation: z.literal("edit"), setId: z.uuid(), name, tuneIds: z.array(z.uuid()).min(2).max(100) }),
  z.object({ operation: z.literal("entry"), bookId: z.uuid(), entryId: z.uuid(), action: z.enum(["up", "down", "remove", "ungroup"]) }),
  z.object({ operation: z.literal("moveTune"), setId: z.uuid(), tuneId: z.uuid(), direction: z.enum(["up", "down"]) }),
  z.object({ operation: z.literal("delete"), setId: z.uuid() }),
]);

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose at least two different tunes; custom names can have up to 80 characters" }, { status: 400 });
  try {
    const input = parsed.data;
    switch (input.operation) {
      case "group": return NextResponse.json({ setId: await groupTunes(user.id, input.bookId, input.name, input.entryIds) });
      case "add": await addSet(user.id, input.bookId, input.setId); break;
      case "edit": await editSet(user.id, input.setId, input.name, input.tuneIds); break;
      case "entry": await changeEntry(user.id, input.bookId, input.entryId, input.action); break;
      case "moveTune": await moveSetTune(user.id, input.setId, input.tuneId, input.direction); break;
      case "delete": await deleteSet(user.id, input.setId); break;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SetError ? error.message : "Could not update the set" }, { status: error instanceof SetError ? 400 : 500 });
  }
}
