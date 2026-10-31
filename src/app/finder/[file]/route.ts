import { NextResponse } from "next/server";
import { signedBlobUrl } from "@/lib/blob";

// The Tune finder's model and tune list are too large for git, so production keeps them in the bucket under finder/
// (scripts/publish-finder.ts puts them there). The finder asks for them here, at a stable address its worker caches
// by, and is sent on to a signed link. In development the copies in public/finder are served before this route.
const FILES = new Set(["model.onnx", "tunes.json", "popularity.json"]);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!FILES.has(file)) return new NextResponse("Not found", { status: 404 });
  const url = signedBlobUrl(`finder/${file}`);
  if (!url) return new NextResponse("The tune finder's files are not configured", { status: 503 });
  // Signed links last 12 hours from the start of the hour, so a redirect can be reused for a few minutes.
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=300" } });
}
