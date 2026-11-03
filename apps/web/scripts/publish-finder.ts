// Publishes the Tune finder to production: uploads public/finder's model.onnx, tunes.json and popularity.json to the
// bucket under finder/, where the /finder/<file> route sends the app. Run after exporting a new model:
//   npx tsx --env-file=.env scripts/publish-finder.ts
// The model and tune list must come from the same export; the worker's cache name (CACHE in src/lib/finder/worker.ts)
// should be bumped in the same deploy so phones fetch the new model instead of their cached one.
import { readFile, stat } from "node:fs/promises";
import { signedBlobUploadUrl } from "../src/lib/blob";

const FILES: Record<string, string> = { "model.onnx": "application/octet-stream", "tunes.json": "application/json", "popularity.json": "application/json" };

for (const [file, type] of Object.entries(FILES)) {
  const path = `public/finder/${file}`;
  const { size, mtime } = await stat(path);
  const url = signedBlobUploadUrl(`finder/${file}`);
  if (!url) throw new Error("B2 is not configured: set the B2_ variables in .env");
  const response = await fetch(url, { method: "PUT", headers: { "Content-Type": type }, body: await readFile(path) });
  if (!response.ok) throw new Error(`${file}: upload failed, ${response.status} ${await response.text()}`);
  console.log(`finder/${file}: ${(size / 1e6).toFixed(1)} MB, exported ${mtime.toISOString().slice(0, 16).replace("T", " ")}`);
}
