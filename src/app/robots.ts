import type { MetadataRoute } from "next";

// Built on each request, so the address follows BETTER_AUTH_URL at run time, not whatever it was when the image was built.
export const dynamic = "force-dynamic";

const baseUrl = (process.env.BETTER_AUTH_URL || "https://tunecompanion.com").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/guides", "/tunes/finder/benchmark", "/books/", "/sign-up", "/sign-in"],
        disallow: ["/api/", "/admin/", "/oauth/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
