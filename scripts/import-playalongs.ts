import "dotenv/config";
import { readFileSync } from "node:fs";
import { inArray, like, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { catalogSettings, playalongTracks } from "../src/db/schema";

// Registers play-along recordings already uploaded to B2 (ml/yue/playalong.py writes the manifest).
type Entry = { settingId: number; tuneId: number; label: string; bpm: number | null; durationMs: number; storageKey: string; model: string };

// --prune <prefix>: also remove registered tracks under that storage prefix that the manifest no longer lists.
const args = process.argv.slice(2);
const pruneAt = args.indexOf("--prune");
const prefix = pruneAt >= 0 ? args.splice(pruneAt, 2)[1] : null;
const path = args[0] || "ml/cache/yue/playalong/manifest.jsonl";
const entries: Entry[] = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

// Postgres takes at most 65,535 parameters a query, so long lists go in chunks.
const CHUNK = 5000;
function chunks<T>(items: T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));
}

try {
  const known = new Set<number>();
  for (const ids of chunks([...new Set(entries.map((entry) => entry.settingId))])) {
    for (const row of await db.select({ settingId: catalogSettings.settingId }).from(catalogSettings).where(inArray(catalogSettings.settingId, ids))) {
      known.add(row.settingId);
    }
  }
  const rows = entries.filter((entry) => known.has(entry.settingId));
  for (const batch of chunks(rows)) {
    await db.insert(playalongTracks).values(batch).onConflictDoUpdate({
      target: playalongTracks.storageKey,
      set: { label: sql`excluded.label`, bpm: sql`excluded.bpm`, durationMs: sql`excluded.duration_ms`, model: sql`excluded.model` },
    });
  }
  console.log(`${rows.length} play-alongs registered; ${entries.length - rows.length} skipped for settings not in the catalog`);
  if (prefix && rows.length) {
    const keep = new Set(rows.map((row) => row.storageKey));
    const registered = await db.select({ storageKey: playalongTracks.storageKey }).from(playalongTracks)
      .where(like(playalongTracks.storageKey, `${prefix}%`));
    const stale = registered.map((row) => row.storageKey).filter((key) => !keep.has(key));
    for (const keys of chunks(stale)) {
      await db.delete(playalongTracks).where(inArray(playalongTracks.storageKey, keys));
    }
    console.log(`${stale.length} play-alongs under ${prefix} removed`);
  }
} finally {
  await pool.end();
}
