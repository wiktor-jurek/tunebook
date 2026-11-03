import keywords from "emojilib";

export const SMART_EMOJI_VERSION = "potion-8m-1.0.4-emojilib-4.0.3-v1";
export const FALLBACK_TUNE_EMOJI = "🎵";

const stopWords = new Set("a an the and or of at in on to for from by with i am is are my your his her our their me it its o s re jig reel hornpipe polka waltz slip slide tune traditional".split(" "));
// Related concepts bridge occupations and older words to the emoji vocabulary.
const related: Record<string, string[]> = {
  tailor: ["necktie"], tailoring: ["necktie"], suit: ["necktie"],
  hag: ["woman mage"], witch: ["woman mage"], sorceress: ["woman mage"],
  father: ["old man"], grandfather: ["old man"], granddad: ["old man"],
  grandmother: ["old woman"], granny: ["old woman"],
  cottage: ["house"], dwelling: ["house"], cabin: ["house"],
  fiddler: ["violin"], fiddle: ["violin"], piper: ["flute"],
  sailor: ["anchor"], mariner: ["anchor"], blacksmith: ["hammer"],
  smith: ["hammer"], cobbler: ["mans shoe"], shoemaker: ["mans shoe"],
  soldier: ["military helmet"], queen: ["crown"], king: ["crown"],
  lass: ["girl"], colleen: ["girl"], lad: ["boy"],
  mare: ["horse"], pony: ["horse"], steed: ["horse"], hound: ["dog"],
  pitchfork: ["trident emblem"], spear: ["crossed swords"],
  whiskey: ["tumbler glass"], whisky: ["tumbler glass"], pint: ["beer mug"],
  churn: ["glass of milk"], brook: ["water wave"], river: ["water wave"],
};

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/['’]s\b/g, "").replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function singular(word: string) {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && word.length > 3 && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
const index = Object.entries(keywords).map(([emoji, words]) => ({
  emoji, primary: normalize(words[0]), phrases: new Set(words.map(normalize)),
  words: new Set(words.flatMap((word) => normalize(word).split(" ").map(singular)).filter((word) => !stopWords.has(word))),
}));
const frequency = new Map<string, number>();
for (const entry of index) for (const word of entry.words) frequency.set(word, (frequency.get(word) ?? 0) + 1);

// The package includes the model weights; inference never downloads or sends titles.
// Share the initialization promise so simultaneous first requests load the model once.
let semanticIndex: Promise<{ embed: typeof import("@yarflam/potion-base-8m").embed; vectors: Float32Array[] }> | undefined;
function getSemanticIndex() {
  return semanticIndex ??= (async () => {
    const { embed } = await import("@yarflam/potion-base-8m");
    const vectors = await embed(Object.values(keywords).map((words) => [...new Set(words.map(normalize))].join(" ")));
    return { embed, vectors };
  })().catch((error) => { semanticIndex = undefined; throw error; });
}

export async function suggestTuneEmoji(title: string): Promise<string> {
  const normalized = normalize(title.slice(0, 300));
  const words = [...new Set(normalized.split(" ").map(singular).filter((word) => word.length > 1 && !stopWords.has(word)))];
  if (!words.length) return FALLBACK_TUNE_EMOJI;
  const { embed, vectors } = await getSemanticIndex();
  const [query] = await embed(words.join(" "));
  // This is a similarity cutoff, not a probability. Avoid arbitrary icons for names
  // with no convincing match; exact vocabulary is a useful prior for short titles.
  let best = FALLBACK_TUNE_EMOJI, bestScore = 0.4;
  for (const [i, entry] of index.entries()) {
    let lexical = 0;
    for (const word of words) {
      if (entry.words.has(word)) lexical += Math.log(1 + index.length / (frequency.get(word) ?? 1)) + (entry.primary === word ? 4 : 0);
      for (const concept of related[word] ?? []) if (entry.phrases.has(concept)) lexical += 14 + (entry.primary === concept ? 6 : 0);
    }
    if (entry.primary.length > 2 && ` ${normalized} `.includes(` ${entry.primary} `)) lexical += 8;
    // Potion produces L2-normalized vectors, so their dot product is cosine similarity.
    const similarity = query.reduce((sum, value, j) => sum + value * vectors[i][j], 0);
    const score = similarity + Math.min(lexical / 40, 0.6);
    // Dataset ordering provides a stable tie-break, favoring the basic emoji variants.
    if (score > bestScore) { bestScore = score; best = entry.emoji; }
  }
  return best;
}
