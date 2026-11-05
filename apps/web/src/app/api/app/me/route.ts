import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getPassport } from "@/lib/passport";

// The native apps' Me screen: who you are as a player. What you can play, by type and key; where your tunes sit between
// what every session plays and the rarities; your favourites (with their music, for the opening bars); your sessions.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, memberSince: new Date(user.createdAt).toISOString() }, ...await getPassport(user.id) });
  } catch {
    return NextResponse.json({ error: "Could not load your passport" }, { status: 500 });
  }
}
