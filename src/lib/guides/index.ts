// The /guides pages: evergreen, public and indexable. guides.json comes from scripts/build-guides.ts.
import data from "@/lib/guides/guides.json";
import { displayTitle } from "@/lib/titles";
import { keyName } from "@/lib/notation";

export type GuideTune = { settingId: number; title: string; kind: string; meter: string; mode: string; abc: string; tunebooks: number };
export type GuideData = {
  generated: string;
  sets: number;
  members: number;
  popularSets: { kind: string; sets: { tunes: number[]; members: number }[] }[];
  followers: Record<string, { tuneId: number; members: number } | null>;
  tunes: Record<string, GuideTune>;
};
export const guideData = data as GuideData;

export type Guide = { slug: string; title: string; summary: string; description: string; updated: string };

export const GUIDES: Guide[] = [
  {
    slug: "first-session-tunes",
    title: "20 tunes to learn for your first Irish session",
    summary: "The polkas, jigs, slip jigs, hornpipes and reels players recommend most, in the order to learn them.",
    description: "The 20 tunes most often recommended for a first Irish trad session, from 1,221 forum posts and The Session's tunebooks, with sheet music you can play along with.",
    updated: "2026-11-01",
  },
  {
    slug: "popular-session-sets",
    title: "The most popular Irish session sets",
    summary: "Which tunes go together, counted from every set The Session's members have saved.",
    description: "The reels, jigs, polkas, slip jigs, hornpipes and slides that Irish session players put together most, counted from 131,000 sets saved on The Session.",
    updated: "2026-11-01",
  },
  {
    slug: "best-tune-finder-apps",
    title: "Tune finder apps compared: JigRipper, Tunepal, FolkFriend, Little Session and Tune Companion",
    summary: "Which app names an Irish tune by ear, measured on the same 539 real recordings.",
    description: "JigRipper, Tunepal, FolkFriend, Little Session and Tune Companion compared: accuracy on 539 real recordings, how fast each names the tune, price and platforms.",
    updated: "2026-11-01",
  },
];

export const guide = (slug: string) => GUIDES.find((g) => g.slug === slug)!;

// Official tunebooks behind the guides' "Open as a tunebook" buttons (scripts/seed-guide-books.ts prints their ids).
// They are the only tunebooks search engines may index.
export const GUIDE_BOOKS: Record<string, string | null> = {
  "first-session-tunes": "ba3a9f66-b56c-4d46-b47e-55707ecac846",
  "popular-session-sets": "61cfa509-41cc-455b-8b07-21e1089ed5f1",
};
export const isGuideBook = (id: string) => Object.values(GUIDE_BOOKS).includes(id);

export function tune(id: number) {
  const found = guideData.tunes[id];
  if (!found) throw new Error(`Tune ${id} is not in guides.json: run npm run guides:build`);
  return found;
}

export const tuneName = (id: number) => displayTitle(tune(id).title);
export const tuneMeta = (id: number) => [tune(id).kind, keyName(tune(id).mode)].filter(Boolean).join(", ");
export const theSessionUrl = (id: number) => `https://thesession.org/tunes/${id}#setting${tune(id).settingId}`;
export const count = (n: number) => n.toLocaleString("en-GB");

/** schema.org JSON-LD, with "<" escaped so no string can close the script tag. */
export const jsonLd = (value: object) => ({ __html: JSON.stringify(value).replace(/</g, "\\u003c") });
