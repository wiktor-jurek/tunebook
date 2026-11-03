import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { ABILITY_LEVELS } from "@/lib/ability";
import { PracticeError, updateTunePractice } from "@/lib/tune-practice";

const input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("tempo"), tempo: z.number().int().min(50).max(150) }).strict(),
  z.object({ operation: z.literal("level"), level: z.enum(ABILITY_LEVELS).nullable() }).strict(),
  z.object({ operation: z.literal("reset") }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose a level or a tempo from 50% to 150%" }, { status: 400 });
  try {
    return NextResponse.json({ practice: await updateTunePractice(user.id, id, parsed.data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PracticeError ? error.message : "Could not save practice progress" }, { status: error instanceof PracticeError ? 404 : 500 });
  }
}
