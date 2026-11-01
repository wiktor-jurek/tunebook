import { PublicHeader } from "@/components/public-header";
import { LandingInteractive } from "@/components/landing-tour";
import { SiteCredits } from "@/components/site-footer";
import type { DemoTrack } from "@/components/landing-sections";
import { getPlayalongsBySetting } from "@/lib/playalongs";

const structuredData = {
  "@context": "https://schema.org",
  "@type": ["WebApplication", "SoftwareApplication"],
  name: "Tune Companion",
  alternateName: ["Shazam for Irish Music"],
  url: "https://tunecompanion.com",
  applicationCategory: "MusicApplication",
  operatingSystem: "iOS, Android, macOS, Windows, Linux, Web",
  description:
    "Name Irish traditional tunes by ear at a session, record the whole night as a setlist, see which tunes you can play, and share tunebooks.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
};

// The tunebook demo's one set: The Kesh, Morrison's and Out on the Ocean, by setting.
const BOOK_SETTINGS = [55, 71, 108];

// The tunebook demo plays real play-along tracks. Without them (no database or bucket), it plays the score instead.
async function demoTracks(): Promise<Record<number, DemoTrack[]>> {
  try {
    const found = await getPlayalongsBySetting(BOOK_SETTINGS);
    return Object.fromEntries(Object.entries(found).map(([id, list]) => [id, list.filter((t) => !t.otherSetting).slice(0, 3).map(({ label, url, timing }) => ({ label, url, timing }))]));
  } catch {
    return {};
  }
}

export async function Landing() {
  const tracks = await demoTracks();
  return (
    <div className="landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <PublicHeader />
      <main>
        <LandingInteractive tracks={tracks} />
      </main>
      <footer className="landing-footer"><SiteCredits /></footer>
    </div>
  );
}
