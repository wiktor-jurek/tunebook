import { NextResponse } from "next/server";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { isSound } from "@/lib/sounds";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let input: { defaultSound?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!isSound(input?.defaultSound)) return NextResponse.json({ error: "Choose a supported sound" }, { status: 400 });
  try {
    await db.insert(userPreferences).values({ userId: user.id, defaultSound: input.defaultSound }).onConflictDoUpdate({ target: userPreferences.userId, set: { defaultSound: input.defaultSound } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save preferences" }, { status: 500 });
  }
}
