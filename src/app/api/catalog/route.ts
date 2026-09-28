import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { saveCatalogSetting, searchCatalog } from "@/lib/library";

export async function GET(request: Request) {
  if (!await currentUser()) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") || "";
  if (!query.trim()) return NextResponse.json({ error: "Paste a tune URL or enter a title" }, { status: 400 });
  try {
    const settings = await searchCatalog(query);
    return NextResponse.json({ settings: settings.map(({ settingId, title, kind, mode, meter, contributor, sourceUrl }) => ({ settingId, title, kind, mode, meter, contributor, sourceUrl })) });
  } catch {
    return NextResponse.json({ error: "Could not search the catalog" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let input: { settingId?: unknown };
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (typeof input?.settingId !== "number" || !Number.isSafeInteger(input.settingId) || input.settingId < 1) return NextResponse.json({ error: "Invalid setting" }, { status: 400 });
  try {
    const tuneId = await saveCatalogSetting(user.id, input.settingId);
    return NextResponse.json({ tuneId });
  } catch (error) {
    if (error instanceof Error && error.message === "Setting not found in the catalog") return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Could not save the tune" }, { status: 500 });
  }
}
