import "dotenv/config";
import { readFileSync } from "node:fs";
import { inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { catalogSettings, playalongTracks } from "../src/db/schema";

// Registers play-along recordings already uploaded to B2 (ml/yue/playalong.py writes the manifest).
type Entry = { settingId: number; tuneId: number; label: string; bpm: number | null; durationMs: number; storageKey: string; model: string };

const path = process.argv[2] || "ml/cache/yue/playalong/manifest.jsonl";
const entries: Entry[] = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

try {
  const known = new Set((await db.select({ settingId: catalogSettings.settingId }).from(catalogSettings)
    .where(inArray(catalogSettings.settingId, [...new Set(entries.map((entry) => entry.settingId))]))).map((row) => row.settingId));
  const rows = entries.filter((entry) => known.has(entry.settingId));
  if (rows.length) {
    await db.insert(playalongTracks).values(rows).onConflictDoUpdate({
      target: playalongTracks.storageKey,
      set: { label: sql`excluded.label`, bpm: sql`excluded.bpm`, durationMs: sql`excluded.duration_ms`, model: sql`excluded.model` },
    });
  }
  console.log(`${rows.length} play-alongs registered; ${entries.length - rows.length} skipped for settings not in the catalog`);
} finally {
  await pool.end();
}
