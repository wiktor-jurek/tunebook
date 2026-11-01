import type { Metadata } from "next";
import { GuideLink } from "@/components/guide-parts";
import { GUIDES } from "@/lib/guides";

const description = "Guides to Irish traditional music sessions: the tunes to learn first, the sets people play, and the apps that name a tune by ear.";

export const metadata: Metadata = {
  title: "Guides to Irish session music",
  description,
  alternates: { canonical: "/guides" },
  openGraph: { title: "Guides to Irish session music", description, type: "website", siteName: "Tune Companion" },
};

export default function GuidesPage() {
  return <div className="guide-wrap">
    <header className="guide-head"><h1>Guides</h1><div className="guide-standfirst"><p>{description}</p></div></header>
    <ul className="guide-index">{GUIDES.map((g) => <li key={g.slug}><GuideLink g={g} /></li>)}</ul>
  </div>;
}
