import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { BookPopularityError, updateBookPopularity } from "@/lib/book-popularity";

const input = z.object({ tuneId: z.uuid(), oftenPlayed: z.boolean() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose a tune and an often played status" }, { status: 400 });
  try {
    return NextResponse.json(await updateBookPopularity(user.id, id, parsed.data.tuneId, parsed.data.oftenPlayed));
  } catch (error) {
    return NextResponse.json({ error: error instanceof BookPopularityError ? error.message : "Could not update often played tunes" }, { status: error instanceof BookPopularityError ? 404 : 500 });
  }
}
