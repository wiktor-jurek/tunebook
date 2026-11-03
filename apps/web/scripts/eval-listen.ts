import "dotenv/config";
import { pool } from "../src/db";
import { identify } from "../src/lib/listen-sessions";
import { DURATION_UNIT, melodyFromAbc } from "../src/lib/melody";
import { MelodyIndex, type IndexedSetting } from "../src/lib/melody-index";
import { SAMPLE_RATE, YinTranscriber } from "../src/lib/pitch-tracker";
import { synthesize, TIMBRES, type SynthNote } from "../src/lib/synthesize";

// Plays random catalog settings as synthetic audio, in a random key, tempo, starting
// point and timbre with ornaments and slips, through the same pipeline as Listen.
const trials = Number(process.env.TRIALS || 300);
const clipSeconds = Number(process.env.CLIP_SECONDS || 15);
let seed = Number(process.env.SEED || 7);
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const started = Date.now();
const { rows } = await pool.query(`SELECT setting_id AS "settingId", tune_id AS "tuneId", title, kind, meter, mode, abc FROM catalog_settings ORDER BY setting_id`);
const warn = console.warn;
console.warn = () => {};
const settings: IndexedSetting[] = [];
for (const row of rows) {
  try { const melody = melodyFromAbc(row); if (melody) settings.push({ ...row, ...melody }); } catch { /* unreadable ABC */ }
}
console.warn = warn;
const index = new MelodyIndex(settings);
console.log(`Indexed ${index.size} of ${rows.length} settings in ${((Date.now() - started) / 1000).toFixed(1)} s`);

function performance(setting: IndexedSetting): SynthNote[] {
  const quaver = 0.11 + random() * 0.07, unit = quaver / (DURATION_UNIT / 8);
  const pitches = Array.from(setting.pitches), durations = Array.from(setting.durations);
  let transpose = Math.floor(random() * 13) - 5;
  if (Math.min(...pitches) + transpose < 55) transpose += 12;
  const notes: SynthNote[] = [];
  let time = 0;
  for (let i = Math.floor(random() * Math.max(1, pitches.length - 40)); i < pitches.length && time < clipSeconds; i++) {
    const midi = pitches[i] + transpose, seconds = durations[i] * unit * (0.92 + random() * 0.16);
    time += seconds;
    if (random() < 0.03) { notes.push({ midi: notes.at(-1)?.midi ?? midi, seconds }); continue; }
    if (seconds > 0.3 && random() < 0.4) {
      // Roll: note, cut above, note, tap below, note.
      const grace = 0.03, rest = (seconds - 2 * grace) / 3;
      notes.push({ midi, seconds: rest }, { midi: midi + 2, seconds: grace }, { midi, seconds: rest }, { midi: midi - 1, seconds: grace }, { midi, seconds: rest });
    } else if (seconds > 0.12 && random() < 0.15) notes.push({ midi: midi + 3, seconds: 0.025 }, { midi, seconds: seconds - 0.025 });
    else notes.push({ midi, seconds });
  }
  return notes;
}

const timbres = Object.values(TIMBRES);
let top1 = 0, top5 = 0, confident = 0, confidentCorrect = 0, confidentAt = 0, chunkTime = 0, chunks = 0;
for (let trial = 0; trial < trials; trial++) {
  const setting = settings[Math.floor(random() * settings.length)];
  const timbre = { ...timbres[Math.floor(random() * timbres.length)], detuneCents: Math.floor(random() * 50) - 25 };
  const audio = synthesize(performance(setting), timbre, random);
  const transcriber = new YinTranscriber(), leaders: number[] = [];
  let result = identify(index, [], 0);
  for (let offset = 0; offset < audio.length; offset += SAMPLE_RATE) {
    const begin = Date.now();
    transcriber.push(audio.subarray(offset, offset + SAMPLE_RATE));
    result = identify(index, transcriber.notes(), transcriber.seconds, leaders);
    chunkTime += Date.now() - begin; chunks++;
    if (result.status === "confident") break;
  }
  const rank = result.matches.findIndex((match) => match.tuneId === setting.tuneId);
  if (rank === 0) top1++;
  if (rank >= 0 && rank < 5) top5++;
  if (rank !== 0 && process.env.VERBOSE) {
    const title = (tuneId?: number) => rows.find((row) => row.tuneId === tuneId)?.title ?? "nothing";
    console.log(`Missed ${title(setting.tuneId)} (setting ${setting.settingId}): heard ${transcriber.notes().length} notes, ranked ${rank < 0 ? "outside" : rank + 1}, top was ${title(result.matches[0]?.tuneId)} at ${result.matches[0]?.score.toFixed(2) ?? "-"}`);
  }
  if (result.status === "confident") { confident++; confidentAt += transcriber.seconds; if (rank === 0) confidentCorrect++; }
}
const percent = (value: number, of = trials) => `${(100 * value / Math.max(1, of)).toFixed(1)}%`;
console.log(`Top-1 ${percent(top1)}, top-5 ${percent(top5)} over ${trials} clips`);
console.log(`Stopped confidently on ${percent(confident)} after ${(confidentAt / Math.max(1, confident)).toFixed(1)} s on average, correct ${percent(confidentCorrect, confident)} of those`);
console.log(`Average ${(chunkTime / chunks).toFixed(0)} ms per second of audio`);
await pool.end();
