import type { MetadataRoute } from "next";

// Added to the home screen, Tune Companion opens as its own app, without browser chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tune Companion",
    short_name: "Tune Companion",
    description: "Tunebooks, practice and a tune finder for Irish and folk sessions.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#fafaf8",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
