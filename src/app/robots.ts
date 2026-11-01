import type { MetadataRoute } from "next";

const baseUrl = (process.env.BETTER_AUTH_URL || "https://tunecompanion.com").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/tunes/finder/benchmark", "/books/", "/sign-up", "/sign-in"],
        disallow: ["/api/", "/admin/", "/oauth/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
