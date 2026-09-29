import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { bookEntries, savedTunes, setTunes, tunebooks, tunePractice, tuneSets } from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as NodePgDatabase, user: null as typeof user.$inferSelect | null }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => state.user }));
import { updateTunePractice } from "./tune-practice";
import { getBook, getLibrary, getSavedTune } from "./library";
import { getMySets } from "./sets";
import { practiceSummary } from "./ability";
import { POST as practice } from "@/app/api/tunes/[id]/practice/route";
import { POST as copyBook } from "@/app/api/books/[id]/save/route";

describe.skipIf(!process.env.TEST_DATABASE_URL)("private tune practice (PostgreSQL)", () => {
  const schema = `practice_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  let owner: typeof user.$inferSelect, viewer: typeof user.$inferSelect;
  let tunes: (typeof savedTunes.$inferSelect)[], viewerTune: typeof savedTunes.$inferSelect, bookId: string, setId: string;
  const request = (body: unknown) => new Request("http://localhost/api/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  beforeAll(async () => {
    state.db = drizzle(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const file of (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort()) await pool.query((await readFile(`drizzle/${file}`, "utf8")).replaceAll('"public".', `"${schema}".`));
    [owner, viewer] = await state.db.insert(user).values([{ id: "owner", name: "Owner", email: "owner@example.test", emailVerified: true }, { id: "viewer", name: "Viewer", email: "viewer@example.test", emailVerified: true }]).returning();
    const rows = [{ settingId: 1, tuneId: 100, title: "Calliope House" }, { settingId: 2, tuneId: 100, title: "Another setting" }, { settingId: 3, tuneId: 101, title: "The Butterfly" }, { settingId: 4, tuneId: 102, title: "Hag at the churn" }];
    tunes = await state.db.insert(savedTunes).values(rows.map((tune) => ({ ...tune, userId: owner.id, abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/100" }))).returning();
    [viewerTune] = await state.db.insert(savedTunes).values({ ...rows[0], userId: viewer.id, abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/100" }).returning();
    const [book] = await state.db.insert(tunebooks).values({ userId: owner.id, name: "Practice book", linkVisible: true }).returning(); bookId = book.id;
    const [set] = await state.db.insert(tuneSets).values({ userId: owner.id, name: "Practice set" }).returning(); setId = set.id;
    await state.db.insert(setTunes).values([{ setId, tuneId: tunes[0].id, position: 0 }, { setId, tuneId: tunes[2].id, position: 1 }]);
    await state.db.insert(bookEntries).values([{ bookId, setId, position: 0 }, { bookId, tuneId: tunes[1].id, position: 1 }, { bookId, tuneId: tunes[3].id, position: 2 }]);
  }, 30000);
  beforeEach(async () => { state.user = owner; await state.db.delete(tunePractice); });
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });

  it("starts existing tunes unlearned without inventing speeds", async () => {
    expect((await getSavedTune(owner.id, tunes[0].id))?.practice).toEqual({ playableTempo: null, levelOverride: null, level: "unlearned" });
    expect(await state.db.select().from(tunePractice)).toHaveLength(0);
  });
  it("records the thresholds and shares best confirmed speed across settings", async () => {
    for (const [tempo, level] of [[50, "learning"], [95, "learning"], [100, "learned"], [120, "learned"], [125, "mastered"], [150, "mastered"]]) {
      const response = await practice(request({ operation: "tempo", tempo }), context(tunes[0].id));
      expect(response.status).toBe(200);
      expect((await response.json()).practice).toMatchObject({ playableTempo: tempo, level });
    }
    await updateTunePractice(owner.id, tunes[1].id, { operation: "tempo", tempo: 70 });
    expect((await getSavedTune(owner.id, tunes[1].id))?.practice).toMatchObject({ playableTempo: 150, level: "mastered" });
    expect(await state.db.select().from(tunePractice)).toHaveLength(1);
  }, 10000);
  it("keeps manual levels independent of speed and supports automatic mode and reset", async () => {
    await updateTunePractice(owner.id, tunes[0].id, { operation: "level", level: "learned" });
    expect((await getSavedTune(owner.id, tunes[0].id))?.practice).toMatchObject({ playableTempo: null, level: "learned" });
    await updateTunePractice(owner.id, tunes[0].id, { operation: "tempo", tempo: 150 });
    await updateTunePractice(owner.id, tunes[0].id, { operation: "level", level: "learning" });
    await updateTunePractice(owner.id, tunes[0].id, { operation: "tempo", tempo: 100 });
    expect((await getSavedTune(owner.id, tunes[1].id))?.practice).toMatchObject({ playableTempo: 150, level: "learning", levelOverride: "learning" });
    await updateTunePractice(owner.id, tunes[0].id, { operation: "level", level: null });
    expect((await getSavedTune(owner.id, tunes[0].id))?.practice.level).toBe("mastered");
    await updateTunePractice(owner.id, tunes[0].id, { operation: "reset" });
    expect((await getSavedTune(owner.id, tunes[0].id))?.practice).toEqual({ playableTempo: null, levelOverride: null, level: "unlearned" });
  }, 10000);
  it("preserves the fastest confirmation under concurrent requests", async () => {
    await Promise.all([100, 150, 50, 125, 75].map((tempo) => updateTunePractice(owner.id, tunes[0].id, { operation: "tempo", tempo })));
    expect((await getSavedTune(owner.id, tunes[0].id))?.practice.playableTempo).toBe(150);
    await Promise.all([updateTunePractice(owner.id, tunes[0].id, { operation: "level", level: "unlearned" }), updateTunePractice(owner.id, tunes[0].id, { operation: "tempo", tempo: 80 })]);
    expect((await getSavedTune(owner.id, tunes[0].id))?.practice).toMatchObject({ playableTempo: 150, levelOverride: "unlearned", level: "unlearned" });
  });
  it("calculates book and set totals from personal levels without counting settings twice", async () => {
    await updateTunePractice(owner.id, tunes[0].id, { operation: "tempo", tempo: 100 });
    await updateTunePractice(owner.id, tunes[2].id, { operation: "level", level: "mastered" });
    await updateTunePractice(owner.id, tunes[3].id, { operation: "tempo", tempo: 50 });
    const book = (await getBook(owner.id, bookId))!;
    expect(practiceSummary(book.tunes.map((row) => row.tune))).toMatchObject({ total: 3, playable: 2, percent: 67 });
    expect(practiceSummary((await getMySets(owner.id)).find((set) => set.id === setId)!.tunes)).toMatchObject({ total: 2, playable: 2, percent: 100 });
    expect((await getLibrary(owner.id)).tunes.filter((tune) => tune.tuneId === 100).every((tune) => tune.practice.level === "learned")).toBe(true);
  });
  it("does not expose or copy the owner's progress to guests and shared-book recipients", async () => {
    await updateTunePractice(owner.id, tunes[0].id, { operation: "tempo", tempo: 150 });
    await updateTunePractice(owner.id, tunes[2].id, { operation: "tempo", tempo: 125 });
    await updateTunePractice(viewer.id, viewerTune.id, { operation: "tempo", tempo: 50 });
    expect((await getBook(null, bookId))!.tunes.every((row) => row.tune.practice.playableTempo === null && row.tune.practice.level === "unlearned")).toBe(true);
    const viewed = (await getBook(viewer.id, bookId))!;
    expect(viewed.tunes.find((row) => row.tune.tuneId === 100)!.tune.practice.level).toBe("learning");
    expect(viewed.tunes.find((row) => row.tune.tuneId === 101)!.tune.practice.level).toBe("unlearned");
    state.user = viewer;
    const response = await copyBook(request({ operation: "book" }), context(bookId));
    expect(response.status).toBe(200);
    const copy = (await getBook(viewer.id, (await response.json()).bookId))!;
    expect(practiceSummary(copy.tunes.map((row) => row.tune))).toMatchObject({ total: 3, playable: 0 });
    expect(await state.db.select().from(tunePractice).where(eq(tunePractice.userId, viewer.id))).toHaveLength(1);
  }, 10000);
  it("enforces authentication, ownership, strict payloads and tempo limits", async () => {
    state.user = null;
    expect((await practice(request({ operation: "tempo", tempo: 100 }), context(tunes[0].id))).status).toBe(401);
    state.user = viewer;
    expect((await practice(request({ operation: "tempo", tempo: 100 }), context(tunes[0].id))).status).toBe(404);
    state.user = owner;
    for (const body of [{ operation: "tempo", tempo: 0 }, { operation: "tempo", tempo: 49 }, { operation: "tempo", tempo: 151 }, { operation: "tempo", tempo: 75.5 }, { operation: "tempo", tempo: "100" }, { operation: "level", level: "expert" }, { operation: "reset", userId: viewer.id }, {}]) {
      expect((await practice(request(body), context(tunes[0].id))).status).toBe(400);
    }
    expect((await practice(request({ operation: "reset" }), context("invalid"))).status).toBe(400);
    expect((await practice(request({ operation: "reset" }), context(randomUUID()))).status).toBe(404);
    expect(await state.db.select().from(tunePractice)).toHaveLength(0);
  });
  it("retains personal progress after deleting a saved setting and cascades on account deletion", async () => {
    await updateTunePractice(viewer.id, viewerTune.id, { operation: "tempo", tempo: 125 });
    await state.db.delete(savedTunes).where(eq(savedTunes.id, viewerTune.id));
    expect(await state.db.select().from(tunePractice).where(eq(tunePractice.userId, viewer.id))).toHaveLength(1);
    await state.db.delete(user).where(eq(user.id, viewer.id));
    expect(await state.db.select().from(tunePractice).where(eq(tunePractice.userId, viewer.id))).toHaveLength(0);
  });
});
