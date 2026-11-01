import { NextResponse, type NextRequest } from "next/server";

// One public address. Once BETTER_AUTH_URL names the canonical host (tunecompanion.com), requests to the old domain and to
// www come back to it, path and query intact, with a permanent redirect (308, so a POST keeps its method). Until then
// nothing redirects, so deploying this before the new domain is live changes nothing.
const OLD_HOSTS = ["libresession.com", "www.libresession.com", "www.tunecompanion.com"];

export function proxy(request: NextRequest) {
  const canonical = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL) : null;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!canonical || canonical.hostname !== "tunecompanion.com" || host === canonical.hostname || !OLD_HOSTS.includes(host)) return NextResponse.next();
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical.origin);
  return NextResponse.redirect(target, 308);
}

export const config = {
  // Every path, except Next's own static files, which are only ever requested from a page on the same host.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
