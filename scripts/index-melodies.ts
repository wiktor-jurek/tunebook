import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { catalogMelodies } from "../src/db/schema";
import { MELODY_VERSION, melodyFromAbc } from "../src/lib/melody";

type Row = { settingId: number; tuneId: number; title: string; kind: string | null; meter: string | null; mode: string | null; abc: string };
let indexed = 0, skipped = 0;

try {
  // Only settings that are new, changed since indexing, or indexed by an older extractor.
  for (;;) {
    const { rows } = await db.execute<Row>(sql`
      SELECT cs.setting_id AS "settingId", cs.tune_id AS "tuneId", cs.title, cs.kind, cs.meter, cs.mode, cs.abc
      FROM catalog_settings cs LEFT JOIN catalog_melodies cm ON cm.setting_id = cs.setting_id
      WHERE cm.setting_id IS NULL OR cm.version <> ${MELODY_VERSION} OR cm.updated_at < cs.updated_at
      ORDER BY cs.setting_id LIMIT 500`);
    if (!rows.length) break;
    const melodies = rows.map((row) => {
      try {
        const melody = melodyFromAbc(row);
        return { settingId: row.settingId, tuneId: row.tuneId, version: MELODY_VERSION, ...(melody ?? { pitches: [], durations: [], chars: [] }) };
      } catch {
        return { settingId: row.settingId, tuneId: row.tuneId, version: MELODY_VERSION, pitches: [], durations: [], chars: [] };
      }
    });
    // Unreadable settings keep an empty row so they are not retried until the setting changes.
    skipped += melodies.filter((melody) => !melody.pitches.length).length;
    indexed += melodies.length;
    await db.insert(catalogMelodies).values(melodies).onConflictDoUpdate({
      target: catalogMelodies.settingId,
      set: { tuneId: sql`excluded.tune_id`, pitches: sql`excluded.pitches`, durations: sql`excluded.durations`, chars: sql`excluded.chars`, version: sql`excluded.version`, updatedAt: sql`now()` },
    });
    if (indexed % 5000 === 0) console.log(`Indexed ${indexed} melodies`);
  }
  console.log(`Melody index complete: ${indexed - skipped} indexed, ${skipped} unreadable`);
} catch (error) {
  console.error(`Melody index failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
