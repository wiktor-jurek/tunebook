import { PublicHeader } from "@/components/public-header";
import { SiteCredits } from "@/components/site-footer";

// Guides are the same for everyone and read from guides.json, so they prerender as static pages.
export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return <div className="landing">
    <PublicHeader />
    <main className="guide-page">{children}</main>
    <footer className="landing-footer"><SiteCredits /></footer>
  </div>;
}
