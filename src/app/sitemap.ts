import type { MetadataRoute } from "next";

// Built on each request, so the address follows BETTER_AUTH_URL at run time, not whatever it was when the image was built.
export const dynamic = "force-dynamic";

const baseUrl = (process.env.BETTER_AUTH_URL || "https://tunecompanion.com").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date("2026-10-31T00:00:00.000Z");
  return [
    { url: `${baseUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/tunes/finder/benchmark`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/sign-up`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
