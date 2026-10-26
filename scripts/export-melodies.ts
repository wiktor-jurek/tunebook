import "dotenv/config";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createGzip } from "node:zlib";
import { pool } from "../src/db";
import { melodyFromAbc } from "../src/lib/melody";

// One JSON line per setting with its played-out melody, for rendering and evaluation in ml/.
// Extraction uses the same abcjs path as the app, so score highlights line up with renders.
const output = process.argv[2] || "ml/data/catalog.jsonl.gz";
mkdirSync(dirname(output), { recursive: true });
const gzip = createGzip();
const finished = new Promise<void>((resolve, reject) => gzip.pipe(createWriteStream(output)).on("finish", () => resolve()).on("error", reject));
let written = 0, skipped = 0;

try {
  const { rows } = await pool.query(`SELECT setting_id AS "settingId", tune_id AS "tuneId", title, kind, meter, mode, abc FROM catalog_settings ORDER BY setting_id`);
  const warn = console.warn;
  console.warn = () => {};
  for (const row of rows) {
    let melody = null;
    try { melody = melodyFromAbc(row); } catch { /* unreadable ABC */ }
    if (!melody) { skipped++; continue; }
    const { abc: _abc, ...meta } = row;
    if (!gzip.write(`${JSON.stringify({ ...meta, ...melody })}\n`)) await new Promise((resolve) => gzip.once("drain", resolve));
    written++;
  }
  console.warn = warn;
  gzip.end();
  await finished;
  console.log(`Exported ${written} melodies to ${output}, skipped ${skipped}`);
} catch (error) {
  console.error(`Export failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
