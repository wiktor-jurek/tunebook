import "dotenv/config";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { catalogSettings, catalogTunes } from "../src/db/schema";

const url = process.env.THESESSION_CSV_URL || "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tunes.csv";
const popularityUrl = process.env.THESESSION_POPULARITY_CSV_URL || "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tune_popularity.csv";

type Row = Record<string, string>;
type Setting = typeof catalogSettings.$inferInsert;
type Popularity = typeof catalogTunes.$inferInsert;

async function csvRows(source: string): Promise<AsyncIterable<Row>> {
  const response = await fetch(source);
  if (!response.ok || !response.body) throw new Error(`Catalog download failed: ${response.status}`);
  return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(parse({ columns: true, bom: true, relax_quotes: true, skip_empty_lines: true }));
}

let batch: Setting[] = [];
let count = 0;

async function flush() {
  if (!batch.length) return;
  const unique = [...new Map(batch.map((row) => [row.settingId, row])).values()];
  await db.insert(catalogSettings).values(unique).onConflictDoUpdate({
    target: catalogSettings.settingId,
    set: {
      tuneId: sql`excluded.tune_id`, title: sql`excluded.title`, kind: sql`excluded.kind`,
      meter: sql`excluded.meter`, mode: sql`excluded.mode`, abc: sql`excluded.abc`,
      contributor: sql`excluded.contributor`, composer: sql`excluded.composer`,
      sourceUrl: sql`excluded.source_url`, updatedAt: sql`now()`,
    },
  });
  count += unique.length;
  batch = [];
  if (count % 5000 === 0) console.log(`Synced ${count} settings`);
}

let popularity: Popularity[] = [];
let popularityCount = 0;

async function flushPopularity() {
  if (!popularity.length) return;
  const unique = [...new Map(popularity.map((row) => [row.tuneId, row])).values()];
  await db.insert(catalogTunes).values(unique).onConflictDoUpdate({ target: catalogTunes.tuneId, set: { tunebooks: sql`excluded.tunebooks` } });
  popularityCount += unique.length;
  popularity = [];
}

try {
  for await (const row of await csvRows(url)) {
    const settingId = Number(row.setting_id);
    const tuneId = Number(row.tune_id);
    if (!Number.isSafeInteger(settingId) || !Number.isSafeInteger(tuneId) || !row.abc || !row.name) continue;
    batch.push({
      settingId, tuneId, title: row.name.trim(), kind: row.type || null,
      meter: row.meter || null, mode: row.mode || null, abc: row.abc,
      contributor: row.username || null, composer: row.composer || null,
      sourceUrl: `https://thesession.org/tunes/${tuneId}#setting${settingId}`,
    });
    if (batch.length >= 500) await flush();
  }
  await flush();
  console.log(`Catalog sync complete: ${count} settings`);

  for await (const row of await csvRows(popularityUrl)) {
    const tuneId = Number(row.tune_id);
    const tunebooks = Number(row.tunebooks);
    if (!Number.isSafeInteger(tuneId) || !Number.isSafeInteger(tunebooks) || tunebooks < 0) continue;
    popularity.push({ tuneId, tunebooks });
    if (popularity.length >= 1000) await flushPopularity();
  }
  await flushPopularity();
  console.log(`Popularity sync complete: ${popularityCount} tunes`);
} catch (error) {
  const cause = error as { cause?: { code?: string; message?: string }; message?: string };
  console.error(`Catalog sync failed: ${cause.cause?.code || "unknown"} ${cause.cause?.message || cause.message?.split("\n")[0] || "unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
