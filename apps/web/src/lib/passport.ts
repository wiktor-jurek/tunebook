import { sql } from "drizzle-orm";
import { db } from "@/db";
import { bookPopularTunes, catalogSettings, catalogTunes, recordings, recordingTunes, tunebooks, tunePractice } from "@/db/schema";
import { practiceSummary, type AbilityLevel, ABILITY_LEVELS } from "@/lib/ability";
import { getSavedTunes } from "@/lib/library";
import { BAND_EDGES } from "@/lib/ml-data";

// A player's passport, for Me on the web and in the apps: what they can play, what kind of player that makes them (a jig
// person or a waltz person, someone who plays what everyone knows or digs for rarities), how many of the tunes every
// session plays they know (the Standards), the stamps they have collected, their favourite tunes and their sessions.

export const POPULARITY_BANDS = ["Very popular", "Popular", "Common", "Uncommon", "Rare"] as const;

/** 1 (very popular) to 5 (rare), from a tune's rank in the catalogue by how many The Session tunebooks hold it. */
export function bandForRank(rank: number, edges: number[] = BAND_EDGES) {
  const band = edges.findIndex((edge) => rank <= edge);
  return band === -1 ? edges.length + 1 : band + 1;
}

type Typed = { kind: string | null; level: AbilityLevel };
export type TypeCount = { kind: string; total: number; playable: number };

const playable = (level: AbilityLevel) => level === "learned" || level === "mastered";

/** Tunes per type, most first; a tune with no type is left out. */
export function typeBreakdown(tunes: Typed[]): TypeCount[] {
  const counts = new Map<string, TypeCount>();
  for (const tune of tunes) {
    const kind = tune.kind?.trim().toLowerCase();
    if (!kind) continue;
    const count = counts.get(kind) ?? { kind, total: 0, playable: 0 };
    count.total++;
    if (playable(tune.level)) count.playable++;
    counts.set(kind, count);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total || b.playable - a.playable || a.kind.localeCompare(b.kind));
}

/** "jigs", "waltzes", "slip jigs", "marches". */
export function pluralKind(kind: string) {
  return /(s|z|ch|sh|x)$/.test(kind) ? `${kind}es` : `${kind}s`;
}

const KIND_TITLES: Record<string, string> = { air: "Slow air soul", waltz: "Waltz person", polka: "Polka person", slide: "Slide person" };

export type Persona = { title: string; line: string };

/** What kind of player the tunes make you: the type that most of what you can play (or, before that, of your tunes) is. */
export function typePersona(types: TypeCount[]): Persona | null {
  const byPlayable = types.some((type) => type.playable > 0);
  const count = (type: TypeCount) => byPlayable ? type.playable : type.total;
  const all = types.reduce((sum, type) => sum + count(type), 0);
  if (!all) return null;
  const top = [...types].sort((a, b) => count(b) - count(a) || b.total - a.total)[0];
  const share = Math.round(count(top) / all * 100);
  const title = KIND_TITLES[top.kind] ?? `${top.kind[0].toUpperCase()}${top.kind.slice(1)} person`;
  const line = byPlayable ? `${share}% of what you can play are ${pluralKind(top.kind)}.` : `${share}% of your tunes are ${pluralKind(top.kind)}.`;
  return { title, line };
}

const POPULARITY_PERSONAS: Persona[] = [
  { title: "Crowd-pleaser", line: "You play the tunes every session knows." },
  { title: "Session regular", line: "Your tunes are the ones that come round most nights." },
  { title: "Off the beaten track", line: "You know the standards and plenty besides." },
  { title: "Deep cut digger", line: "Most of your tunes are ones few sessions play." },
  { title: "Collector of rarities", line: "You go looking for tunes hardly anyone has." },
];

/** Where your tunes sit between what everyone plays and the rare ones, from their median band. */
export function popularityPersona(bands: number[]): Persona | null {
  if (!bands.length) return null;
  const sorted = [...bands].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  return POPULARITY_PERSONAS[Math.min(Math.max(median, 1), POPULARITY_PERSONAS.length) - 1];
}

export type FavouriteSignals = { tuneId: number; title: string; level: AbilityLevel; starred: number; heard: number };

/** Tunes you lean on: starred as often played in your tunebooks, heard at your sessions, and ones you can lead. */
export function rankFavourites<T extends FavouriteSignals>(tunes: T[], limit = 6): T[] {
  const score = (tune: T) => tune.starred * 3 + tune.heard * 2 + ABILITY_LEVELS.indexOf(tune.level);
  return tunes.filter((tune) => tune.starred > 0 || tune.heard > 0 || tune.level === "mastered")
    .sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title)).slice(0, limit);
}

const HEADLINE_CLAUSES: Record<string, string> = {
  "Crowd-pleaser": "who plays the tunes everyone knows",
  "Session regular": "who knows the session favourites",
  "Off the beaten track": "who goes off the beaten track",
  "Deep cut digger": "who digs deep cuts",
  "Collector of rarities": "who collects rarities",
};

/** The passport's one line: "A jig person who digs deep cuts". */
export function passportHeadline(type: Persona | null, popularity: Persona | null) {
  if (!type) return "Your passport starts with your first tune.";
  const who = type.title.toLowerCase();
  const clause = popularity ? HEADLINE_CLAUSES[popularity.title] : undefined;
  return `${/^[aeiou]/.test(who) ? "An" : "A"} ${who}${clause ? ` ${clause}` : ""}.`;
}

export type StampTune = { tuneId: number; kind: string | null; level: AbilityLevel; band?: number; addedAt: Date; levelAt?: Date | null };
export type StampSession = { recordedAt: Date; durationMs: number; tunes: number };
export type Stamp = { id: string; title: string; line: string; earned: boolean; at: string | null; progress: { have: number; need: number } | null };

const ALL_ROUND = ["jig", "reel", "hornpipe", "polka", "slide"];
const earliest = (dates: Date[]) => dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null;
const nth = (dates: Date[], n: number) => dates.length >= n ? [...dates].sort((a, b) => a.getTime() - b.getTime())[n - 1] : null;

/**
 * The passport's stamps, earned or still to get, each dated when it can be known: a tune by when it was saved, a level by
 * when it was last set, a session by when it was recorded.
 */
export function stampsFor(tunes: StampTune[], sessions: StampSession[]): Stamp[] {
  const playable = tunes.filter((tune) => tune.level === "learned" || tune.level === "mastered");
  const playedAt = (tune: StampTune) => tune.levelAt ?? tune.addedAt;
  const playDates = playable.map(playedAt);
  const kinds = ALL_ROUND.map((kind) => earliest(playable.filter((tune) => tune.kind?.trim().toLowerCase() === kind).map(playedAt)));
  const allRound = kinds.every(Boolean) ? new Date(Math.max(...kinds.map((date) => date!.getTime()))) : null;
  const sessionDates = sessions.map((session) => session.recordedAt);
  const stamp = (id: string, title: string, line: string, at: Date | null, progress: { have: number; need: number } | null = null): Stamp =>
    ({ id, title, line, earned: !!at, at: at?.toISOString() ?? null, progress: at ? null : progress });
  // Earned first, in the order they were earned; then the ones still to get, nearest first as listed.
  const all = [
    stamp("first-tune", "First tune", "Saved your first tune.", earliest(tunes.map((tune) => tune.addedAt))),
    stamp("play-10", "Ten to play", "10 tunes you can play along with.", nth(playDates, 10), { have: playable.length, need: 10 }),
    stamp("lead", "Leading off", "The first tune you can lead.", earliest(tunes.filter((tune) => tune.level === "mastered").map(playedAt))),
    stamp("first-session", "First session", "Recorded your first session.", earliest(sessionDates)),
    stamp("all-rounder", "All-rounder", "A jig, a reel, a hornpipe, a polka and a slide you can play.", allRound,
      { have: kinds.filter(Boolean).length, need: ALL_ROUND.length }),
    stamp("deep-cut", "Deep cut", "You can play a tune hardly any session knows.", earliest(playable.filter((tune) => tune.band === 5).map(playedAt))),
    stamp("big-night", "Big night", "20 tunes named in one session.", earliest(sessions.filter((session) => session.tunes >= 20).map((session) => session.recordedAt))),
    stamp("marathon", "Marathon", "A session over two hours.", earliest(sessions.filter((session) => session.durationMs >= 2 * 3_600_000).map((session) => session.recordedAt))),
    stamp("play-50", "Fifty to play", "50 tunes you can play along with.", nth(playDates, 50), { have: playable.length, need: 50 }),
    stamp("sessions-10", "Regular", "Ten sessions recorded.", nth(sessionDates, 10), { have: sessions.length, need: 10 }),
    stamp("play-100", "A hundred to play", "100 tunes you can play along with.", nth(playDates, 100), { have: playable.length, need: 100 }),
  ];
  return [...all.filter((stamp) => stamp.earned).sort((a, b) => a.at!.localeCompare(b.at!)), ...all.filter((stamp) => !stamp.earned)];
}

export type MonthCount = { month: string; sessions: number; minutes: number };

/** The last [count] months ("2026-11"), oldest first, with none-recorded months as zeros. */
export function lastMonths(sessions: { recordedAt: Date; durationMs: number }[], now = new Date(), count = 12): MonthCount[] {
  const months: MonthCount[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ month: date.toISOString().slice(0, 7), sessions: 0, minutes: 0 });
  }
  for (const session of sessions) {
    const month = months.find((m) => m.month === session.recordedAt.toISOString().slice(0, 7));
    if (month) { month.sessions++; month.minutes += Math.round(session.durationMs / 60000); }
  }
  return months;
}

export type StandardTune = { tuneId: number; title: string; kind: string | null; level: AbilityLevel | null; savedId: string | null };

/** The most-held tunes on The Session, each with where you stand with it (null: not one of yours). */
export function markStandards(top: { tuneId: number; title: string; kind: string | null }[], mine: Map<number, { id: string; level: AbilityLevel }>) {
  const tunes: StandardTune[] = top.map((tune) => ({ ...tune, level: mine.get(tune.tuneId)?.level ?? null, savedId: mine.get(tune.tuneId)?.id ?? null }));
  const count = (levels: AbilityLevel[]) => tunes.filter((tune) => tune.level && levels.includes(tune.level)).length;
  return { tunes, total: tunes.length, playable: count(["learned", "mastered"]), learning: count(["learning"]), wanted: count(["wanted"]) };
}

const rows = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];

export async function getPassport(userId: string) {
  const tunes = await getSavedTunes(userId);
  // One saved setting per tune: the passport counts tunes, not settings.
  const unique = [...new Map(tunes.map((tune) => [tune.tuneId, tune])).values()];
  const ids = unique.map((tune) => tune.tuneId);
  const idList = ids.length ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : sql`NULL`;
  const [ranks, starred, heard, sessionRows, [books], [mostHeard], top, levelDates] = await Promise.all([
    rows<{ tuneId: number; rank: number }>(sql`
      SELECT c.tune_id AS "tuneId", (SELECT count(*) FROM ${catalogTunes} c2 WHERE c2.tunebooks > c.tunebooks)::integer + 1 AS rank
      FROM ${catalogTunes} c WHERE c.tune_id IN (${idList})`),
    rows<{ tuneId: number; books: number }>(sql`
      SELECT p.tune_id AS "tuneId", count(*)::integer AS books
      FROM ${bookPopularTunes} p JOIN ${tunebooks} b ON b.id = p.book_id
      WHERE b.user_id = ${userId} GROUP BY p.tune_id`),
    rows<{ tuneId: number; times: number }>(sql`
      SELECT rt.tune_id AS "tuneId", count(*)::integer AS times
      FROM ${recordingTunes} rt JOIN ${recordings} r ON r.id = rt.recording_id
      WHERE r.user_id = ${userId} AND r.uploaded_at IS NOT NULL AND NOT rt.rejected GROUP BY rt.tune_id`),
    rows<{ id: string; recordedAt: string; durationMs: number; tunes: number }>(sql`
      SELECT r.id, r.recorded_at AS "recordedAt", r.duration_ms AS "durationMs", count(rt.id) FILTER (WHERE NOT rt.rejected)::integer AS tunes
      FROM ${recordings} r LEFT JOIN ${recordingTunes} rt ON rt.recording_id = r.id
      WHERE r.user_id = ${userId} AND r.uploaded_at IS NOT NULL GROUP BY r.id ORDER BY r.recorded_at`),
    rows<{ count: number }>(sql`SELECT count(*)::integer AS count FROM ${tunebooks} b WHERE b.user_id = ${userId}`),
    rows<{ tuneId: number; title: string; times: number }>(sql`
      SELECT rt.tune_id AS "tuneId", min(s.title) AS title, count(*)::integer AS times
      FROM ${recordingTunes} rt JOIN ${recordings} r ON r.id = rt.recording_id JOIN ${catalogSettings} s ON s.setting_id = rt.setting_id
      WHERE r.user_id = ${userId} AND r.uploaded_at IS NOT NULL AND NOT rt.rejected
      GROUP BY rt.tune_id ORDER BY times DESC, title LIMIT 1`),
    // The Standards: the 100 tunes most held in The Session's members' tunebooks, each by its first setting's name.
    rows<{ tuneId: number; title: string; kind: string | null }>(sql`
      SELECT c.tune_id AS "tuneId", s.title, s.kind FROM ${catalogTunes} c
      CROSS JOIN LATERAL (SELECT cs.title, cs.kind FROM ${catalogSettings} cs WHERE cs.tune_id = c.tune_id ORDER BY cs.setting_id LIMIT 1) s
      ORDER BY c.tunebooks DESC, c.tune_id LIMIT 100`),
    rows<{ tuneId: number; updatedAt: string }>(sql`
      SELECT p.tune_id AS "tuneId", p.updated_at AS "updatedAt" FROM ${tunePractice} p WHERE p.user_id = ${userId}`),
  ]);
  const sessions = sessionRows.map((row) => ({ ...row, recordedAt: new Date(row.recordedAt) }));
  const levelAt = new Map(levelDates.map((row) => [row.tuneId, new Date(row.updatedAt)]));

  const bandOf = new Map(ranks.map((row) => [row.tuneId, bandForRank(row.rank)]));
  const starredOf = new Map(starred.map((row) => [row.tuneId, row.books]));
  const heardOf = new Map(heard.map((row) => [row.tuneId, row.times]));
  const summary = practiceSummary(unique);
  const types = typeBreakdown(unique.map((tune) => ({ kind: tune.kind, level: tune.practice.level })));
  const bands = POPULARITY_BANDS.map((label, i) => ({ band: i + 1, label, tunes: 0, playable: 0 }));
  for (const tune of unique) {
    const band = bandOf.get(tune.tuneId);
    if (!band) continue;
    bands[band - 1].tunes++;
    if (playable(tune.practice.level)) bands[band - 1].playable++;
  }
  const playableBands = unique.filter((tune) => playable(tune.practice.level)).map((tune) => bandOf.get(tune.tuneId)).filter((band) => band !== undefined);
  const rarest = unique.filter((tune) => playable(tune.practice.level) && bandOf.has(tune.tuneId))
    .sort((a, b) => bandOf.get(b.tuneId)! - bandOf.get(a.tuneId)! || a.title.localeCompare(b.title))[0];
  const personas = {
    type: typePersona(types),
    // Judged on what you can play once there is some; until then, on every tune you have.
    popularity: popularityPersona(playableBands.length ? playableBands : [...bandOf.values()]),
  };
  const biggest = [...sessions].sort((a, b) => b.tunes - a.tunes || a.recordedAt.getTime() - b.recordedAt.getTime())[0];
  const favourites = rankFavourites(unique.map((tune) => ({ ...tune, level: tune.practice.level, starred: starredOf.get(tune.tuneId) ?? 0, heard: heardOf.get(tune.tuneId) ?? 0 })));
  const keys = [...unique.reduce((counts, tune) => tune.mode ? counts.set(tune.mode, (counts.get(tune.mode) ?? 0) + 1) : counts, new Map<string, number>())]
    .map(([mode, total]) => ({ mode, total })).sort((a, b) => b.total - a.total || a.mode.localeCompare(b.mode)).slice(0, 5);

  return {
    repertoire: { tunes: summary.total, playable: summary.playable, counts: summary.counts, tunebooks: books?.count ?? 0 },
    types,
    keys,
    popularity: { bands, rarest: rarest ? { id: rarest.id, title: rarest.title, band: bandOf.get(rarest.tuneId)! } : null },
    personas,
    headline: passportHeadline(personas.type, personas.popularity),
    standards: markStandards(top, new Map(unique.map((tune) => [tune.tuneId, { id: tune.id, level: tune.practice.level }]))),
    stamps: stampsFor(unique.map((tune) => ({ tuneId: tune.tuneId, kind: tune.kind, level: tune.practice.level, band: bandOf.get(tune.tuneId),
      addedAt: tune.createdAt, levelAt: levelAt.get(tune.tuneId) ?? null })), sessions),
    favourites: favourites.map((tune) => ({
      id: tune.id, tuneId: tune.tuneId, settingId: tune.settingId, title: tune.title, emoji: tune.emoji, kind: tune.kind, meter: tune.meter, mode: tune.mode,
      abc: tune.abc, practice: tune.practice, starred: tune.starred, heard: tune.heard,
    })),
    sessions: {
      recordings: sessions.length, minutes: Math.round(sessions.reduce((sum, session) => sum + session.durationMs, 0) / 60000),
      tunesHeard: heard.length, mostHeard: mostHeard ?? null,
      byMonth: lastMonths(sessions),
      biggestNight: biggest?.tunes ? { id: biggest.id, recordedAt: biggest.recordedAt.toISOString(), tunes: biggest.tunes } : null,
      longestMs: Math.max(0, ...sessions.map((session) => session.durationMs)),
    },
  };
}

export type Passport = Awaited<ReturnType<typeof getPassport>>;
