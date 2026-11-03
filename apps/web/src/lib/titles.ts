import { keyName } from "@/lib/notation";
import { parseSessionUrl } from "@/lib/session-url";

// The Session files titles with the article last ("Lilting Banshee, The") so they sort by their real first word.
// People say "The Lilting Banshee": show that, and keep sorting by the stored form.
const TRAILING_ARTICLE = /^(.+), (The|A|An)$/;
const ARTICLES = new Set(["the", "a", "an"]);

export function displayTitle(title: string) {
  const match = TRAILING_ARTICLE.exec(title.trim());
  return match ? `${match[2]} ${match[1]}` : title;
}

/** Set names are tune titles joined with " / "; each part reads naturally. */
export function displaySetTitle(name: string) {
  return name.split(" / ").map(displayTitle).join(" / ");
}

/** Folds Irish fadas, possessives ("Homer's" -> "homer") and punctuation into plain lower-case words. */
export function foldSearch(text: string | null | undefined) {
  return (text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`ʼ]s\b/g, "")
    .replace(/['’`ʼ]/g, "")
    .replace(/[^a-z0-9/#]+/g, " ")
    .trim();
}

/** Strips a plural or un-apostrophised possessive trailing 's' ("homers" -> "homer", "reels" -> "reel"). */
export function stemWord(word: string) {
  const clean = word.replace(/^#(\d+)$/, "$1");
  return clean.length >= 4 && clean.endsWith("s") && !/[ius]s$/.test(clean) ? clean.slice(0, -1) : clean;
}

/** Search words with articles dropped (unless the query is only articles), stemmed so "homer's", "homers" and "homer" match. */
export function searchWords(query: string | null | undefined) {
  const raw = foldSearch(query).split(/\s+/).filter(Boolean);
  const withoutArticles = raw.filter((word) => !ARTICLES.has(word));
  return (withoutArticles.length ? withoutArticles : raw).map(stemWord);
}

export type SearchableTune = {
  title: string;
  kind?: string | null;
  mode?: string | null;
  meter?: string | null;
  composer?: string | null;
  tuneId?: number;
  settingId?: number;
};

export type PreparedSearchTune = {
  titleWords: string;
  titleKindWords: string;
  titleHaystack: string;
  haystack: string;
  tuneId?: number;
  settingId?: number;
};

export function prepareSearchTune(tune: SearchableTune): PreparedSearchTune {
  const shown = displayTitle(tune.title);
  const titleWords = searchWords(shown).join(" ");
  const titleKindWords = [titleWords, ...searchWords(tune.kind)].filter(Boolean).join(" ");
  const titleHaystack = `${foldSearch(shown)} ${titleWords} ${foldSearch(tune.kind)} ${titleKindWords}`;
  const haystack = ` ${titleHaystack} ${foldSearch(tune.mode)} ${foldSearch(keyName(tune.mode ?? null))} ${foldSearch(tune.meter)} ${foldSearch(tune.composer)} `;
  return { titleWords, titleKindWords, titleHaystack, haystack, tuneId: tune.tuneId, settingId: tune.settingId };
}

export function matchesPreparedWord(prepared: PreparedSearchTune, word: string, isLast: boolean) {
  if (word.length === 1) {
    if (prepared.haystack.includes(` ${word} `)) return true;
    return isLast && ` ${prepared.titleWords} `.includes(` ${word}`);
  }
  return prepared.haystack.includes(word);
}

export function matchesPreparedTune(prepared: PreparedSearchTune, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const parsed = parseSessionUrl(trimmed);
  if (parsed) return parsed.settingId ? prepared.settingId === parsed.settingId : prepared.tuneId === parsed.tuneId;
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    if (prepared.tuneId === id || prepared.settingId === id) return true;
  }
  const words = searchWords(trimmed);
  if (!words.length) return true;
  return words.every((word, index) => matchesPreparedWord(prepared, word, index === words.length - 1));
}

export function matchesTuneQuery(tune: SearchableTune, query: string) {
  return matchesPreparedTune(prepareSearchTune(tune), query);
}

/** 0 = exact title (or title + type) match, 1 = title prefix match, 2 = all words in title + type, 3 = composer/key/meter match. */
export function preparedSearchRank(prepared: PreparedSearchTune, words: string[], numericId: number | null = null) {
  if (!words.length) return 0;
  if (numericId !== null && (prepared.tuneId === numericId || prepared.settingId === numericId)) return 0;
  const joined = words.join(" ");
  if (prepared.titleWords === joined || prepared.titleKindWords === joined) return 0;
  if (prepared.titleWords.startsWith(joined) || prepared.titleKindWords.startsWith(joined)) return 1;
  if (words.every((word) => prepared.titleHaystack.includes(word))) return 2;
  return 3;
}

export function tuneSearchRank(tune: SearchableTune, query: string) {
  const trimmed = query.trim();
  const numericId = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  return preparedSearchRank(prepareSearchTune(tune), searchWords(trimmed), numericId);
}

