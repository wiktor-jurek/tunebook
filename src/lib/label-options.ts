// What the labeller's client and server share: queues, filters and tag options (no server imports here).

export const QUEUES = {
  album: { label: "Album sections", kinds: ["album"] },
  youtube: { label: "YouTube clips", kinds: ["youtube_video"] },
  sessions: { label: "Sessions", kinds: ["youtube_full"] },
} as const;
export type Queue = keyof typeof QUEUES;
export const FILTERS = { unchecked: "Not checked", set: "Sets to split", checked: "Checked right", rejected: "Rejected", all: "All" } as const;
export type Filter = keyof typeof FILTERS;
export type Verdict = "yes" | "no" | "set";

export const INSTRUMENTS = ["fiddle", "flute", "whistle", "low whistle", "uilleann pipes", "accordion", "concertina", "banjo", "mandolin", "harp", "guitar", "bouzouki", "piano", "bodhrán", "voice", "other"];
export const ENSEMBLES = ["solo", "duet", "trio", "small group", "big session"];
export const PLACES = ["pub", "stage", "studio", "home", "outdoors"];
