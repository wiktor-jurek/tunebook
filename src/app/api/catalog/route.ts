import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { getSavedTune, saveCatalogSetting, searchCatalog, searchCatalogTunes } from "@/lib/library";
import { trackServer } from "@/lib/server-analytics";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q") || "";
  const kind = params.get("kind") || undefined;
  if (!query.trim()) return NextResponse.json({ error: "Paste a tune URL or enter a title" }, { status: 400 });
  try {
    const [user, { tunes }, settings] = await Promise.all([
      currentUser(),
      searchCatalogTunes({ query, kind, sort: "popularity", limit: 20, offset: 0 }),
      searchCatalog(query),
    ]);
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    trackServer("catalog_searched", { source: "web", query: query.trim(), result_count: tunes.length,
      top_titles: tunes.slice(0, 5).map((tune) => tune.title).join(" | ") }, { userId: user.id, request, url: "/" });
    return NextResponse.json({
      tunes,
      settings: settings.map(({ settingId, title, kind, mode, meter, contributor, sourceUrl }) => ({ settingId, title, kind, mode, meter, contributor, sourceUrl })),
    });
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
    const tune = await getSavedTune(user.id, tuneId);
    return NextResponse.json({ tuneId, tune });
  } catch (error) {
    if (error instanceof Error && error.message === "Setting not found in the catalog") return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Could not save the tune" }, { status: 500 });
  }
}
