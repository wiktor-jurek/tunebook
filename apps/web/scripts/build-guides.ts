// Builds src/lib/guides/guides.json for the /guides pages from The Session's open data, so the pages render
// without the database: each guide tune's first setting, how many member tunebooks hold it, and the sets
// members save most. Run after the catalog sync, or whenever the guides should catch up: npm run guides:build
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { FIRST_SESSION_IDS } from "../src/lib/guides/first-session";

const DATA = "https://raw.githubusercontent.com/adactio/TheSession-data/main/csv";
const OUT = new URL("../src/lib/guides/guides.json", import.meta.url);
// Sets shown per kind, and the kinds the popular-sets guide covers, in its order.
const PER_KIND = 10;
const KINDS = ["reel", "jig", "polka", "slip jig", "hornpipe", "slide"];

type Row = Record<string, string>;

async function* rows(name: string): AsyncIterable<Row> {
  const response = await fetch(`${DATA}/${name}.csv`);
  if (!response.ok || !response.body) throw new Error(`${name}.csv download failed: ${response.status}`);
  yield* Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(parse({ columns: true, bom: true, relax_quotes: true, skip_empty_lines: true }));
}

async function main() {
  const tunebooks = new Map<number, number>();
  for await (const row of rows("tune_popularity")) tunebooks.set(Number(row.tune_id), Number(row.tunebooks));

  // Members' sets: each set's tunes in order, and who saved it. A set counts once per member.
  const sets = new Map<string, { member: string; tunes: [number, number][] }>();
  for await (const row of rows("sets")) {
    const set = sets.get(row.tuneset) ?? { member: row.member_id, tunes: [] };
    set.tunes.push([Number(row.settingorder), Number(row.tune_id)]);
    sets.set(row.tuneset, set);
  }
  const members = new Set([...sets.values()].map((set) => set.member));
  // The same tunes in any order are one set; it is shown in the order most members play it.
  const combos = new Map<string, { members: Set<string>; orders: Map<string, Set<string>> }>();
  const pairs = new Map<string, Set<string>>();
  for (const { member, tunes } of sets.values()) {
    const order = tunes.sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    if (order.length < 2 || order.length > 4) continue;
    for (let i = 1; i < order.length; i++) {
      const pair = `${order[i - 1]},${order[i]}`;
      pairs.set(pair, (pairs.get(pair) ?? new Set()).add(member));
    }
    const key = [...order].sort((a, b) => a - b).join(",");
    const combo = combos.get(key) ?? { members: new Set(), orders: new Map() };
    combo.members.add(member);
    combo.orders.set(order.join(","), (combo.orders.get(order.join(",")) ?? new Set()).add(member));
    combos.set(key, combo);
  }
  const ranked = [...combos.values()].map((combo) => ({
    tunes: [...combo.orders.entries()].sort((a, b) => b[1].size - a[1].size)[0][0].split(",").map(Number),
    members: combo.members.size,
  })).sort((a, b) => b.members - a.members);

  // First settings (the lowest setting id, as the catalog shows) of every tune a guide names.
  const first = new Map<number, Row>();
  const kinds = new Map<number, string>();
  for await (const row of rows("tunes")) {
    const id = Number(row.tune_id);
    kinds.set(id, row.type);
    const seen = first.get(id);
    if (!seen || Number(row.setting_id) < Number(seen.setting_id)) first.set(id, row);
  }
  const popularSets = KINDS.map((kind) => ({
    kind,
    sets: ranked.filter((set) => set.tunes.every((id) => kinds.get(id) === kind)).slice(0, PER_KIND),
  }));
  // Each first-session tune's most common next tune, from members' sets.
  const followers = Object.fromEntries(FIRST_SESSION_IDS.map((id) => {
    const best = [...pairs.entries()].filter(([pair]) => pair.startsWith(`${id},`)).sort((a, b) => b[1].size - a[1].size)[0];
    return [id, best ? { tuneId: Number(best[0].split(",")[1]), members: best[1].size } : null];
  }));

  const wanted = new Set([...FIRST_SESSION_IDS, ...popularSets.flatMap((group) => group.sets.flatMap((set) => set.tunes)),
    ...Object.values(followers).flatMap((f) => (f ? [f.tuneId] : []))]);
  const tunes = Object.fromEntries([...wanted].sort((a, b) => a - b).map((id) => {
    const row = first.get(id);
    if (!row) throw new Error(`Tune ${id} is not in tunes.csv`);
    return [id, { settingId: Number(row.setting_id), title: row.name, kind: row.type, meter: row.meter, mode: row.mode, abc: row.abc, tunebooks: tunebooks.get(id) ?? 0 }];
  }));

  const out = { generated: new Date().toISOString().slice(0, 10), sets: sets.size, members: members.size, popularSets, followers, tunes };
  await writeFile(OUT, JSON.stringify(out));
  console.log(`${sets.size} sets from ${members.size} members; ${Object.keys(tunes).length} tunes written to ${OUT.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
