import { sql } from "drizzle-orm";
import { db } from "@/db";

// Numbers for /admin/data: what training and evaluation data there is, where it comes from, how much is
// labelled, and whether any evaluation tune has leaked into a training set. All reads; the ml tools write.

const rows = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];
// Real recordings, as opposed to generated (YuE2) audio.
const REAL = sql`s.kind in ('youtube_video', 'youtube_full', 'album', 'app_recording')`;
// Catalogue-rank edges between popularity bands, as on the benchmark page (ml/eval/benchmark.py BAND_RANKS).
export const BAND_EDGES = [100, 500, 2000, 8000];

export type Inventory = { kind: string; sources: number; stored: number; segments: number; hours: number };
export type Labels = { kind: string; labelSource: string; yes: number; no: number; unverified: number; sets: number };
export type Coverage = { band: number; tunes: number; real: number; realTrain: number; realEval: number; yue: number };
export type Daily = { day: string; searches: number; found: number };
export type Dataset = { id: number; name: string; purpose: string; createdAt: Date; segments: number; tunes: number; leaked: number };

export async function getMlOverview() {
  const [inventory, labels, roles, coverage, harvest, datasets, recent] = await Promise.all([
    rows<Inventory>(sql`
      select s.kind, count(distinct s.id)::int as sources, count(distinct s.id) filter (where s.storage_key is not null)::int as stored,
        count(g.id)::int as segments, round(coalesce(sum(g.end_s - g.start_s), 0)::numeric / 3600, 1)::float as hours
      from ml.sources s left join ml.segments g on g.source_id = s.id group by 1 order by 1`),
    rows<Labels>(sql`
      select s.kind, g.label_source as "labelSource", count(*) filter (where g.verified = 'yes')::int as yes,
        count(*) filter (where g.verified = 'no')::int as no, count(*) filter (where g.verified is null)::int as unverified, count(*) filter (where g.verified = 'set')::int as sets
      from ml.segments g join ml.sources s on s.id = g.source_id where s.kind <> 'yue' group by 1, 2 order by 1, 2`),
    rows<{ role: string; tunes: number }>(sql`select role, count(*)::int as tunes from ml.tune_roles group by 1 order by 1`),
    rows<Coverage>(sql`
      with tunes as (select distinct tune_id from catalog_settings),  -- tunes in no tunebook are missing from catalog_tunes
      ranked as (select t.tune_id, row_number() over (order by coalesce(c.tunebooks, 0) desc, t.tune_id) as rank
        from tunes t left join catalog_tunes c on c.tune_id = t.tune_id),
      banded as (select tune_id, 1 + (rank > ${BAND_EDGES[0]})::int + (rank > ${BAND_EDGES[1]})::int + (rank > ${BAND_EDGES[2]})::int + (rank > ${BAND_EDGES[3]})::int as band from ranked),
      heard as (select g.tune_id, bool_or(${REAL} and coalesce(g.verified, '') <> 'no') as real, bool_or(s.kind = 'yue') as yue
        from ml.segments g join ml.sources s on s.id = g.source_id where g.tune_id is not null group by 1)
      select b.band, count(*)::int as tunes, count(*) filter (where h.real)::int as real,
        count(*) filter (where h.real and coalesce(r.role, 'train') = 'train')::int as "realTrain", count(*) filter (where h.real and r.role = 'eval')::int as "realEval",
        count(*) filter (where h.yue)::int as yue
      from banded b left join heard h on h.tune_id = b.tune_id left join ml.tune_roles r on r.tune_id = b.tune_id group by 1 order by 1`),
    rows<Daily>(sql`
      with days as (select generate_series(current_date - 13, current_date, interval '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*) from ml.searches q where q.searched_at::date = d.day)::int as searches,
        (select count(*) from ml.sources s where s.kind = 'album' and s.created_at::date = d.day)::int as found
      from days d order by d.day`),
    rows<Dataset>(sql`
      select id, name, purpose, created_at as "createdAt", (counts->>'segments')::int as segments, (counts->>'tunes')::int as tunes,
        jsonb_array_length(leaked_tunes)::int as leaked
      from ml.datasets order by created_at desc limit 20`),
    rows<{ labelled: number }>(sql`select count(*)::int as labelled from ml.segments where verified_at > now() - interval '7 days'`),
  ]);
  return { inventory, labels, roles, coverage, harvest, datasets, labelledThisWeek: recent[0]?.labelled ?? 0 };
}
