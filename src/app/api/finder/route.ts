import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { bare, getFinderTunes, searchCatalog } from "@/lib/library";
import { displayTitle } from "@/lib/titles";

// The tune finder's lookups: `ids` for tunes it heard, or `q` for a tune someone names out loud.
// Both answer in the same shape, so a searched tune shows exactly like a heard one.
export async function GET(request: Request) {
  const user = await currentUser();
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  try {
    if (query) {
      const settings = await searchCatalog(query);
      const ids = [...new Set(settings.map((setting) => setting.tuneId))].slice(0, 20);
      const tunes = await getFinderTunes(user?.id ?? null, ids);
      // Someone calling out a tune names it: the exact title first, then titles starting with those words, then the most played.
      const words = bare(query);
      const rank = (title: string) => { const t = bare(displayTitle(title)); return t === words ? 0 : t.startsWith(words) ? 1 : 2; };
      tunes.sort((a, b) => rank(a.title) - rank(b.title) || b.tunebooks - a.tunebooks);
      return NextResponse.json({ tunes: tunes.slice(0, 8) });
    }
    const ids = (params.get("ids") || "").split(",").map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!ids.length || ids.length > 20) return NextResponse.json({ error: "Give 1 to 20 tune ids, or a title to search" }, { status: 400 });
    return NextResponse.json({ tunes: await getFinderTunes(user?.id ?? null, [...new Set(ids)]) });
  } catch {
    return NextResponse.json({ error: "Could not look up the tunes" }, { status: 500 });
  }
}
