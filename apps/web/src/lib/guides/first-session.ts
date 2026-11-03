// The first-session list: chosen by hand from three signals, snapshotted on 2026-11-01.
// - posters: how many different people named the tune in 37 beginner and first-session threads on The Session's
//   forum (1,221 posts, read through its JSON API; aliases matched, ambiguous one-word names left out);
// - lists: how many published beginner lists name it (siamsa.ie, McNeela Music, Chiff & Fipple);
// - tunebooks: how many The Session members keep it in their tunebook (scripts/build-guides.ts refreshes this).
// Groups run in the order most teachers suggest learning them: polkas, then jigs, slip jigs, hornpipes and reels.

export type FirstSessionTune = { tuneId: number; posters: number; lists: number; note: string };
export type FirstSessionGroup = { kind: string; title: string; intro: string; tunes: FirstSessionTune[] };

export const FIRST_SESSION_SOURCES = {
  threads: 37,
  posts: 1221,
  lists: [
    { name: "Siamsa: Best beginner tunes in Irish traditional music", url: "https://siamsa.ie/beginner-tunes/" },
    { name: "McNeela Music: The best beginner tunes for all traditional Irish instruments", url: "https://blog.mcneelamusic.com/best-beginner-traditional-tunes/" },
    { name: "Chiff & Fipple: Best session tunes for beginners to learn", url: "https://www.chiffandfipple.com/t/best-session-tunes-for-beginners-to-learn/91459" },
  ],
};

export const FIRST_SESSION: FirstSessionGroup[] = [
  {
    kind: "polka",
    title: "Polkas",
    intro: "Short, bouncy and forgiving at any speed. Most teachers start here.",
    tunes: [
      { tuneId: 441, posters: 8, lists: 2, note: "Two short parts and a tune nearly everyone knows. Often the first tune taught." },
      { tuneId: 1075, posters: 7, lists: 2, note: "Learn it in A first: it skips the awkward high D, then move it to D." },
      { tuneId: 357, posters: 9, lists: 1, note: "Usually played just before John Ryan's, often with The Forty-Two Pound Cheque between them." },
    ],
  },
  {
    kind: "jig",
    title: "Jigs",
    intro: "Three quavers to the beat. These six come up at almost every session.",
    tunes: [
      { tuneId: 55, posters: 30, lists: 2, note: "The most recommended first tune on The Session's forum, by a long way." },
      { tuneId: 71, posters: 17, lists: 1, note: "Usually played straight after The Kesh. Learn the pair." },
      { tuneId: 108, posters: 19, lists: 1, note: "A G major jig with a lift, and The Kesh's other favourite partner." },
      { tuneId: 19, posters: 13, lists: 1, note: "Bright and in D; a good test of keeping the rhythm steady." },
      { tuneId: 111, posters: 13, lists: 0, note: "Simple runs that sit well under the fingers on whistle and fiddle." },
      { tuneId: 5, posters: 11, lists: 0, note: "Played everywhere, often after Banish Misfortune." },
    ],
  },
  {
    kind: "slip jig",
    title: "Slip jigs",
    intro: "Nine beats to the bar. Fewer of them get played, so two cover most sessions.",
    tunes: [
      { tuneId: 10, posters: 13, lists: 2, note: "The slip jig. If a session plays one, it's this." },
      { tuneId: 52, posters: 13, lists: 0, note: "The usual partner for The Butterfly." },
    ],
  },
  {
    kind: "hornpipe",
    title: "Hornpipes",
    intro: "Slower and dotted. A good place to work on swing.",
    tunes: [
      { tuneId: 651, posters: 14, lists: 1, note: "The friendliest hornpipe, and it leads into The Harvest Home." },
      { tuneId: 49, posters: 18, lists: 0, note: "Played after The Boys of Bluehill by more members than any other hornpipe pair." },
    ],
  },
  {
    kind: "reel",
    title: "Reels",
    intro: "The bulk of any session, and the fastest. Learn them slowly and they'll come up to speed.",
    tunes: [
      { tuneId: 27, posters: 24, lists: 2, note: "The most-saved tune on The Session. It almost plays itself." },
      { tuneId: 1, posters: 19, lists: 1, note: "The reel everyone knows. It leads into Drowsy Maggie, The Wise Maid or The Maid Behind the Bar." },
      { tuneId: 118, posters: 11, lists: 0, note: "The usual follower for Cooley's." },
      { tuneId: 182, posters: 16, lists: 1, note: "A D major reel with an easy shape. A favourite first reel." },
      { tuneId: 64, posters: 15, lists: 2, note: "You'll hear it at virtually every session." },
      { tuneId: 8, posters: 11, lists: 0, note: "Sits in G and pairs with The Sailor's Bonnet." },
      { tuneId: 98, posters: 16, lists: 0, note: "A gentle G major reel; a good one to bring up to speed." },
    ],
  },
];

export const FIRST_SESSION_IDS = FIRST_SESSION.flatMap((group) => group.tunes.map((tune) => tune.tuneId));
