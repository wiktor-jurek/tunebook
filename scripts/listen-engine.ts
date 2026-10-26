import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { identify } from "../src/lib/listen-sessions";
import { MelodyIndex, type IndexedSetting } from "../src/lib/melody-index";
import { SAMPLE_RATE, YinTranscriber } from "../src/lib/pitch-tracker";

// Benchmark adapter for the symbolic engine: streams each clip in one-second chunks
// as Listen would, and records the ranking at each checkpoint for ml/eval/run.py.
// Usage: tsx scripts/listen-engine.ts <clips.json> <out.jsonl> [catalog.jsonl.gz]
const [clipsPath, outPath, catalogPath = "ml/data/catalog.jsonl.gz"] = process.argv.slice(2);
const CHECKPOINTS = [5, 10, 15];

function readWav(path: string) {
  const file = readFileSync(path);
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString("ascii", offset, offset + 4), size = file.readUInt32LE(offset + 4);
    if (id === "fmt " && (file.readUInt16LE(offset + 10) !== 1 || file.readUInt32LE(offset + 12) !== SAMPLE_RATE || file.readUInt16LE(offset + 22) !== 16)) throw new Error(`${path} is not 16 kHz mono 16-bit`);
    if (id === "data") return new Int16Array(file.buffer.slice(file.byteOffset + offset + 8, file.byteOffset + offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no audio`);
}

const settings: IndexedSetting[] = gunzipSync(readFileSync(catalogPath)).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const index = new MelodyIndex(settings);
const clips: Array<{ id: string; path: string }> = JSON.parse(readFileSync(clipsPath, "utf8"));
const lines: string[] = [];
for (const clip of clips) {
  const audio = readWav(clip.path), transcriber = new YinTranscriber(), leaders: number[] = [];
  const rankings: Record<string, number[]> = {};
  let confident: { seconds: number; tuneId: number } | null = null;
  for (let second = 1; second * SAMPLE_RATE <= audio.length + SAMPLE_RATE - 1; second++) {
    transcriber.push(audio.subarray((second - 1) * SAMPLE_RATE, second * SAMPLE_RATE));
    const result = identify(index, transcriber.notes(), transcriber.seconds, leaders);
    if (!confident && result.status === "confident") confident = { seconds: second, tuneId: result.matches[0].tuneId };
    if (CHECKPOINTS.includes(second)) rankings[second] = result.matches.map((match) => match.tuneId);
  }
  lines.push(JSON.stringify({ id: clip.id, rankings, confident }));
}
writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log(`Ranked ${clips.length} clips`);
