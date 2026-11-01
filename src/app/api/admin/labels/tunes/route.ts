import { NextResponse } from "next/server";
import { adminUser } from "@/lib/session";
import { findTunes } from "@/lib/labels";

export async function GET(request: Request) {
  if (!(await adminUser())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ tunes: await findTunes(new URL(request.url).searchParams.get("q") ?? "") });
}
