import { sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { signedBlobUrl } from "@/lib/blob";
import { searchCatalogTunes } from "@/lib/library";
import type { SegmentMeta } from "@/db/ml-schema";

// The labeller (/admin/label): queues of labelled stretches of audio to check, each shown with its surrounding
// audio, music-activity lane and the engines' guesses, saved back to ml.segments. Ported from ml/eval/review.py.

export { ENSEMBLES, FILTERS, INSTRUMENTS, PLACES, QUEUES } from "@/lib/label-options";
export type { Filter, Queue, Verdict } from "@/lib/label-options";
import { QUEUES, type Filter, type Queue, type Verdict } from "@/lib/label-options";

const rows = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];

/** A group is what is labelled together: a set's segments within one source, or a lone segment. */
export const groupKey = (sourceId: number, setId: string | null, segmentId: number) => (setId ? `${sourceId}~${setId}` : `${segmentId}`);
function parseGroup(key: string): { sourceId: number; setId: string } | { segmentId: number } | null {
  const at = key.indexOf("~");
  if (at < 0) return /^\d+$/.test(key) ? { segmentId: Number(key) } : null;
  const sourceId = Number(key.slice(0, at));
  return Number.isSafeInteger(sourceId) && at < key.length - 1 ? { sourceId, setId: key.slice(at + 1) } : null;
}

export type QueueItem = { key: string; queue: Queue; title: string; tunes: number; verified: string | null; why?: string };

/** ml.tune_roles reasons that mark the bands test set (ml/store_import.py). */
const BANDS_REASON = "bands set:";

type GroupRow = {
  key: string; kind: string; title: string; tunes: number; unchecked: number; sets: number; no: number; yes: number;
  evalRole: boolean; trainOnly: boolean; bands: boolean; popularity: number; sourceId: number; start: number;
};

const queueOf = (kind: string) => (Object.keys(QUEUES) as Queue[]).find((q) => (QUEUES[q].kinds as readonly string[]).includes(kind)) ?? "album";
const stateOf = (g: GroupRow): Filter => (g.unchecked ? "unchecked" : g.sets ? "set" : g.no ? "rejected" : "checked");
const toItem = (g: GroupRow, why?: string): QueueItem => ({
  key: g.key, queue: queueOf(g.kind), title: g.title, tunes: g.tunes, verified: g.unchecked ? null : g.sets ? "set" : g.no ? "no" : "yes", ...(why ? { why } : {}),
});

async function listGroups(kinds: readonly string[]) {
  return rows<GroupRow>(sql`
    select case when g.set_id is null then g.id::text else s.id || '~' || g.set_id end as key, min(s.kind) as kind,
      coalesce(min(cs.title), min(s.title), 'Untitled') as title, count(*)::int as tunes,
      count(*) filter (where g.verified is null)::int as unchecked, count(*) filter (where g.verified = 'set')::int as sets,
      count(*) filter (where g.verified = 'no')::int as no, count(*) filter (where g.verified = 'yes')::int as yes,
      coalesce(bool_or(r.role = 'eval'), false) as "evalRole", coalesce(bool_and(r.role = 'train'), false) as "trainOnly",
      coalesce(bool_or(r.reason like ${BANDS_REASON + "%"}), false) as bands,
      max(coalesce(ct.tunebooks, 0))::int as popularity, min(s.id)::int as "sourceId", min(g.start_s)::float as start
    from ml.segments g join ml.sources s on s.id = g.source_id
      left join lateral (select title from catalog_settings c where c.tune_id = g.tune_id order by setting_id limit 1) cs on true
      left join catalog_tunes ct on ct.tune_id = g.tune_id left join ml.tune_roles r on r.tune_id = g.tune_id
    where s.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)}) and s.storage_key is not null
    group by 1, case when g.set_id is null then g.id else s.id end`);
}

/** The queue's groups under a filter, benchmark (eval) tunes first, then the most popular. */
export async function listQueue(queue: Queue, filter: Filter): Promise<{ items: QueueItem[]; counts: Record<Filter, number> }> {
  const groups = await listGroups(QUEUES[queue].kinds);
  const counts = { unchecked: 0, set: 0, checked: 0, rejected: 0, all: groups.length };
  for (const g of groups) counts[stateOf(g)]++;
  const items = groups.filter((g) => filter === "all" || stateOf(g) === filter)
    .sort((a, b) => Number(b.evalRole) - Number(a.evalRole) || b.popularity - a.popularity || a.sourceId - b.sourceId || a.start - b.start)
    .map((g) => toItem(g));
  return { items, counts };
}

/** How much labelling a group helps, as a tier (lower first) and the reason shown to the labeller; null when it is done.
 *  Test-set labels come first, the thinnest set first: each wrong label in the 31-clip bands set moves it ~3 points.
 *  The test sets follow ml/train/classifier.py prepare(): album sections of bands tunes and of the benchmark's eval
 *  half, and YouTube clips and session tunes of any tune outside the benchmark's train half. */
export function rank(g: Pick<GroupRow, "kind" | "unchecked" | "sets" | "evalRole" | "trainOnly" | "bands">): { tier: number; why: string } | null {
  const queue = queueOf(g.kind);
  if (queue === "album") {
    if (!g.unchecked) return null;
    if (g.bands) return { tier: 0, why: "Bands test set: the smallest, so every check counts most" };
    if (g.evalRole) return { tier: 3, why: "Albums test set: check the label is right" };
    return { tier: 6, why: "Training data: check the label is right" };
  }
  const test = !g.trainOnly;
  if (g.unchecked) {
    if (queue === "youtube") return test ? { tier: 1, why: "YouTube test clip that nobody has checked" } : { tier: 5, why: "YouTube clip (training tune)" };
    return test ? { tier: 4, why: "Session test tune that nobody has checked" } : { tier: 5, why: "Session tune (training tune)" };
  }
  if (g.sets && queue === "youtube") {
    return test ? { tier: 2, why: "A set left out of the YouTube test: split it into its tunes to add clips" }
      : { tier: 5, why: "A set to split (training tunes)" };
  }
  return null;
}

/** Everything still to label, across queues, in the order that most improves the test sets; popular tunes first within a tier. */
export async function listNext(): Promise<{ items: QueueItem[]; left: number }> {
  const groups = await listGroups(Object.values(QUEUES).flatMap((q) => q.kinds));
  const ranked = groups.flatMap((g) => { const r = rank(g); return r ? [{ g, ...r }] : []; })
    .sort((a, b) => a.tier - b.tier || b.g.popularity - a.g.popularity || a.g.sourceId - b.g.sourceId || a.g.start - b.g.start);
  return { items: ranked.map(({ g, why }) => toItem(g, why)), left: ranked.filter((r) => r.tier <= 4).length };
}

export type Segment = { id: number; startS: number; endS: number; tuneId: number | null; title: string | null; kind: string | null; verified: string | null; meta: SegmentMeta | null };
export type EngineGuesses = { engine: string; window: number; hop: number; windows: { t: number; tune: number; name: string; cos: number | null }[] };
/** A labelled stretch of the same source outside the group being labelled, for the labeller's own lane. */
export type OtherLabel = { startS: number; endS: number; tuneId: number | null; title: string | null; verified: string | null };
export type GroupDetail = {
  key: string; queue: Queue; source: { id: number; kind: string; title: string | null; channel: string | null; video: string | null };
  // Seconds into the source of the loaded audio's first sample, and the audio's length; segment times are in source seconds.
  audio: { url: string; start: number; end: number | null; offsetInVideo: number };
  segments: Segment[]; tags: { instruments: string[]; ensemble: string | null; setting: string | null }; notes: string;
  lane: { fps: number; score: number[]; suggested?: { start: number; end: number } } | null; guesses: EngineGuesses[];
  others: OtherLabel[];
};

type SourceRow = { id: number; kind: string; title: string | null; channel: string | null; storage_key: string; meta: Record<string, unknown> | null };

async function blobJson<T>(key: unknown): Promise<T | null> {
  if (typeof key !== "string" || !key) return null;
  const url = signedBlobUrl(key);
  if (!url) return null;
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  return response?.ok ? ((await response.json()) as T) : null;
}

async function groupSegments(key: string) {
  const group = parseGroup(key);
  if (!group) return null;
  const where = "segmentId" in group ? sql`g.id = ${group.segmentId}` : sql`g.source_id = ${group.sourceId} and g.set_id = ${group.setId}`;
  const segments = await rows<Segment & { sourceId: number; setId: string | null; instruments: string | null; ensemble: string | null; settingTag: string | null; notes: string | null; labelSource: string; confidence: number; position: number | null }>(sql`
    select g.id, g.source_id as "sourceId", g.set_id as "setId", g.start_s::float as "startS", g.end_s::float as "endS", g.tune_id as "tuneId",
      g.verified, g.meta, g.instruments, g.ensemble, g.setting_tag as "settingTag", g.notes, g.label_source as "labelSource", g.confidence, g.position,
      cs.title, cs.kind
    from ml.segments g left join lateral (select title, kind from catalog_settings c where c.tune_id = g.tune_id order by setting_id limit 1) cs on true
    where ${where} order by g.position nulls last, g.start_s`);
  return segments.length ? segments : null;
}

export async function getGroup(key: string, queue: Queue): Promise<GroupDetail | null> {
  const segments = await groupSegments(key);
  if (!segments) return null;
  const [source] = await rows<SourceRow>(sql`select id, kind, title, channel, storage_key, meta from ml.sources where id = ${segments[0].sourceId}`);
  if (!source?.storage_key) return null;
  const meta = source.meta ?? {};
  // A session's set comes with its own cut of the recording; anything else loads its whole source.
  const window = segments[0].setId ? (meta.windows as Record<string, { key: string; start_s: number; end_s: number; analysis_key?: string }> | undefined)?.[segments[0].setId] : undefined;
  const audioKey = window?.key ?? source.storage_key;
  const start = window?.start_s ?? 0, end = window?.end_s ?? null;
  const url = signedBlobUrl(audioKey);
  if (!url) return null;
  const others = await rows<OtherLabel>(sql`
    select g.start_s::float as "startS", g.end_s::float as "endS", g.tune_id as "tuneId", g.verified, cs.title
    from ml.segments g left join lateral (select title from catalog_settings c where c.tune_id = g.tune_id order by setting_id limit 1) cs on true
    where g.source_id = ${source.id} and g.id not in (${sql.join(segments.map((x) => sql`${x.id}`), sql`, `)})
      and g.end_s > ${start} and (${end}::float is null or g.start_s < ${end})
    order by g.start_s`);
  const [analysis, ...prelabels] = await Promise.all([
    blobJson<{ score_fps: number; score: number[]; suggested?: { start: number; end: number } }>(window?.analysis_key ?? meta.analysis_key),
    ...Object.entries((meta.prelabel_keys as Record<string, string>) ?? {}).map(async ([engine, k]) => {
      const data = await blobJson<Omit<EngineGuesses, "engine">>(k);
      // Guesses are timed from the start of the source's audio; keep those inside the loaded stretch, timed in source seconds.
      return data && { engine, window: data.window, hop: data.hop, windows: data.windows.filter((w) => w.t >= start && (end === null || w.t + data.window <= end)) };
    }),
  ]);
  const first = segments[0];
  return {
    key, queue, source: { id: source.id, kind: source.kind, title: source.title, channel: source.channel, video: (meta.video as string) ?? null },
    // YouTube clips past the cached minutes record offset_s; album sections, video_start_s (ml/store_import.py).
    audio: { url, start, end, offsetInVideo: Number(meta.offset_s ?? meta.video_start_s ?? 0) },
    segments: segments.map(({ id, startS, endS, tuneId, title, kind, verified, meta: m }) => ({ id, startS, endS, tuneId, title, kind, verified, meta: m })),
    tags: { instruments: first.instruments ? first.instruments.split(/[;,]\s*/).filter(Boolean) : [], ensemble: first.ensemble, setting: first.settingTag },
    notes: first.notes ?? "",
    lane: analysis ? { fps: analysis.score_fps, score: analysis.score, suggested: analysis.suggested } : null,
    guesses: prelabels.filter((p): p is EngineGuesses => Boolean(p)),
    others,
  };
}

export type Save = { segments: { startS: number; endS: number; tuneId: number | null }[]; verdict: Verdict; tags: GroupDetail["tags"]; notes: string };

export class LabelError extends Error {}

/** The rows a save writes, by review.py's rules: every tune named before "correct"; "wrong" keeps the old times and
 *  tunes; a YouTube clip split into several tunes becomes a set; a session's tunes keep their set and are renumbered. */
export function planSave(queue: Queue, old: { startS: number; endS: number; tuneId: number | null; setId: string | null; meta: SegmentMeta | null; video?: string | null }[], save: Save) {
  if (!old.length) throw new LabelError("Nothing to label");
  const keep = save.verdict === "no";
  const segments = keep ? old.map(({ startS, endS, tuneId }) => ({ startS, endS, tuneId })) : save.segments;
  if (!segments.length) throw new LabelError("A label needs at least one tune");
  if (save.verdict === "yes" && segments.some((s) => !s.tuneId)) throw new LabelError("Name every tune before marking it correct");
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!(s.endS > s.startS)) throw new LabelError("Each tune must end after it starts");
    if (i && s.startS < segments[i - 1].endS - 0.01) throw new LabelError("Tunes may not overlap");
  }
  const setId = old[0].setId ?? (queue === "youtube" && segments.length > 1 ? `${old[0].video ?? "clip"}@${segments[0].startS.toFixed(1)}` : null);
  return segments.map((s, i) => ({
    ...s, setId, position: setId ? i + 1 : null, meta: old[i]?.meta ?? null,
    startS: Math.round(s.startS * 10) / 10, endS: Math.round(s.endS * 10) / 10,
  }));
}

/** Replaces the group's segments in one transaction; returns the group's key afterwards. */
export async function saveGroup(key: string, queue: Queue, save: Save): Promise<string> {
  const current = await groupSegments(key);
  if (!current) throw new LabelError("This label no longer exists");
  const [source] = await rows<SourceRow>(sql`select id, kind, title, channel, storage_key, meta from ml.sources where id = ${current[0].sourceId}`);
  const planned = planSave(queue, current.map((s) => ({ ...s, video: (source?.meta?.video as string) ?? null })), save);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from ml.segments where id = any($1)", [current.map((s) => s.id)]);
    const ids: number[] = [];
    for (const s of planned) {
      const result = await client.query(
        `insert into ml.segments (source_id, start_s, end_s, tune_id, set_id, position, label_source, confidence, verified, verified_at,
           instruments, ensemble, setting_tag, notes, origin, meta)
         values ($1, $2, $3, $4, $5, $6, 'human', $7, $8, now(), $9, $10, $11, $12, 'admin/label', $13) returning id`,
        [current[0].sourceId, s.startS, s.endS, s.tuneId, s.setId, s.position, save.verdict === "yes" ? 1 : 0.5, save.verdict,
          save.tags.instruments.join(", ") || null, save.tags.ensemble, save.tags.setting, save.notes.trim() || null, s.meta ? JSON.stringify(s.meta) : null]);
      ids.push(result.rows[0].id);
    }
    await client.query("commit");
    return groupKey(current[0].sourceId, planned[0].setId, ids[0]);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Catalogue tunes for the tune picker: titles (with or without "The"), Session links or numbers, most popular first. */
export async function findTunes(query: string) {
  if (!query.trim()) return [];
  const found = await searchCatalogTunes({ query, sort: "popularity", limit: 12, offset: 0 });
  return found.tunes.map(({ tuneId, title, kind }) => ({ tuneId, title, kind }));
}
