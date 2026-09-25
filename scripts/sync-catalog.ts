import "dotenv/config";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { catalogSettings } from "../src/db/schema";

const url = process.env.THESESSION_CSV_URL || "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv/tunes.csv";
const response = await fetch(url);
if (!response.ok || !response.body) throw new Error(`Catalog download failed: ${response.status}`);

type Row = Record<string, string>;
type Setting = typeof catalogSettings.$inferInsert;
const parser = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(parse({ columns: true, bom: true, relax_quotes: true, skip_empty_lines: true }));
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

try {
  for await (const item of parser) {
    const row = item as Row;
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
} catch (error) {
  const cause = error as { cause?: { code?: string; message?: string }; message?: string };
  console.error(`Catalog sync failed: ${cause.cause?.code || "unknown"} ${cause.cause?.message || cause.message?.split("\n")[0] || "unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
