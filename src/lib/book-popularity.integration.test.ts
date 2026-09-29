import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { bookEntries, bookPopularTunes, bookShares, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as NodePgDatabase, user: null as typeof user.$inferSelect | null }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => state.user }));
vi.mock("@/lib/tune-emojis", () => ({
  withTuneEmojis: async (tunes: (typeof savedTunes.$inferSelect)[]) => tunes.map((tune) => ({ ...tune, emoji: "🎵", suggestedEmoji: "🎵" })),
}));
import { getBook, getSavedTune } from "./library";
import { updateBookPopularity } from "./book-popularity";
import { groupTunes, changeEntry, getMySets } from "./sets";
import { POST as popularity } from "@/app/api/books/[id]/popularity/route";
import { POST as copyBook } from "@/app/api/books/[id]/save/route";

describe.skipIf(!process.env.TEST_DATABASE_URL)("session repertoire (PostgreSQL)", () => {
  const schema = `popularity_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  let owner: typeof user.$inferSelect, viewer: typeof user.$inferSelect;
  let tunes: (typeof savedTunes.$inferSelect)[], bookId: string, otherBookId: string;
  const request = (body: unknown) => new Request("http://localhost/api/popularity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  beforeAll(async () => {
    state.db = drizzle(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const file of (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort()) await pool.query((await readFile(`drizzle/${file}`, "utf8")).replaceAll('"public".', `"${schema}".`));
    [owner, viewer] = await state.db.insert(user).values([{ id: "owner", name: "Owner", email: "owner@example.test", emailVerified: true }, { id: "viewer", name: "Viewer", email: "viewer@example.test", emailVerified: true }]).returning();
    tunes = await state.db.insert(savedTunes).values([
      { settingId: 1, tuneId: 100, title: "Calliope House" }, { settingId: 2, tuneId: 100, title: "Another setting" },
      { settingId: 3, tuneId: 101, title: "The Butterfly" }, { settingId: 4, tuneId: 102, title: "Outside the book" },
    ].map((tune) => ({ ...tune, userId: owner.id, abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/100" }))).returning();
  });
  beforeEach(async () => {
    state.user = owner;
    await state.db.delete(tunebooks);
    await state.db.delete(tuneSets);
    const books = await state.db.insert(tunebooks).values([{ userId: owner.id, name: "Session A", linkVisible: true }, { userId: owner.id, name: "Session B" }]).returning();
    [bookId, otherBookId] = books.map((book) => book.id);
    const [set] = await state.db.insert(tuneSets).values({ userId: owner.id, name: "Shared set" }).returning();
    await state.db.insert(setTunes).values([{ setId: set.id, tuneId: tunes[0].id, position: 0 }, { setId: set.id, tuneId: tunes[2].id, position: 1 }]);
    await state.db.insert(bookEntries).values([{ bookId, setId: set.id, position: 0 }, { bookId, tuneId: tunes[1].id, position: 1 }, { bookId: otherBookId, setId: set.id, position: 0 }]);
  });
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });

  it("defaults to unmarked and keeps marks specific to the session, including reused sets", async () => {
    expect((await getBook(owner.id, bookId))!.tunes.every(({ tune }) => !tune.oftenPlayed)).toBe(true);
    const response = await popularity(request({ tuneId: tunes[0].id, oftenPlayed: true }), context(bookId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tuneId: 100, oftenPlayed: true });
    const book = (await getBook(owner.id, bookId))!;
    expect(book.tunes.filter(({ tune }) => tune.tuneId === 100).every(({ tune }) => tune.oftenPlayed)).toBe(true);
    expect(book.tunes.find(({ tune }) => tune.tuneId === 101)!.tune.oftenPlayed).toBe(false);
    expect((await getBook(owner.id, otherBookId))!.tunes.every(({ tune }) => !tune.oftenPlayed)).toBe(true);
    expect(await getSavedTune(owner.id, tunes[0].id)).not.toHaveProperty("oftenPlayed");
    expect((await getMySets(owner.id))[0].tunes[0]).not.toHaveProperty("oftenPlayed");
  });
  it("shows the same repertoire to guests, link viewers and email recipients", async () => {
    await updateBookPopularity(owner.id, bookId, tunes[0].id, true);
    for (const viewerId of [null, viewer.id, owner.id]) {
      expect((await getBook(viewerId, bookId))!.tunes.filter(({ tune }) => tune.tuneId === 100).every(({ tune }) => tune.oftenPlayed)).toBe(true);
    }
    await state.db.update(tunebooks).set({ linkVisible: false }).where(eq(tunebooks.id, bookId));
    expect(await getBook(null, bookId)).toBeNull();
    await state.db.insert(bookShares).values({ bookId, email: viewer.email });
    expect((await getBook(viewer.id, bookId))!.tunes[0].tune.oftenPlayed).toBe(true);
  });
  it("unmarks all settings and makes repeat or concurrent assignments idempotent", async () => {
    await Promise.all(Array.from({ length: 4 }, () => updateBookPopularity(owner.id, bookId, tunes[0].id, true)));
    expect(await state.db.select().from(bookPopularTunes)).toHaveLength(1);
    await updateBookPopularity(owner.id, bookId, tunes[1].id, false);
    await updateBookPopularity(owner.id, bookId, tunes[0].id, false);
    expect((await getBook(owner.id, bookId))!.tunes.every(({ tune }) => !tune.oftenPlayed)).toBe(true);
    expect(await state.db.select().from(bookPopularTunes)).toHaveLength(0);
  });
  it("preserves repertoire when grouping and ungrouping tunes", async () => {
    const [extra] = await state.db.insert(bookEntries).values({ bookId, tuneId: tunes[3].id, position: 2 }).returning();
    await updateBookPopularity(owner.id, bookId, tunes[1].id, true);
    const single = (await getBook(owner.id, bookId))!.sections.find((section) => section.kind === "tune")!;
    const set = await groupTunes(owner.id, bookId, undefined, [single.entryId, extra.id]);
    expect((await getBook(owner.id, bookId))!.tunes.filter(({ tune }) => tune.tuneId === 100).every(({ tune }) => tune.oftenPlayed)).toBe(true);
    const grouped = (await getBook(owner.id, bookId))!.sections.find((section) => section.kind === "set" && section.setId === set)!;
    await changeEntry(owner.id, bookId, grouped.entryId, "ungroup");
    expect((await getBook(owner.id, bookId))!.tunes.filter(({ tune }) => tune.tuneId === 100).every(({ tune }) => tune.oftenPlayed)).toBe(true);
  });
  it("copies session repertoire into an independent book, without adding personal favourites", async () => {
    await updateBookPopularity(owner.id, bookId, tunes[0].id, true);
    state.user = viewer;
    const response = await copyBook(request({ operation: "book" }), context(bookId));
    expect(response.status).toBe(200);
    const copyId = (await response.json()).bookId;
    const copy = (await getBook(viewer.id, copyId))!;
    const tune = copy.tunes.find(({ tune }) => tune.tuneId === 100)!.tune;
    expect(copy.tunes.filter(({ tune }) => tune.tuneId === 100).every(({ tune }) => tune.oftenPlayed)).toBe(true);
    await updateBookPopularity(viewer.id, copyId, tune.id, false);
    expect((await getBook(viewer.id, copyId))!.tunes.every(({ tune }) => !tune.oftenPlayed)).toBe(true);
    expect((await getBook(owner.id, bookId))!.tunes[0].tune.oftenPlayed).toBe(true);
    expect(await getSavedTune(viewer.id, tune.id)).not.toHaveProperty("oftenPlayed");
  });
  it("requires authentication, book ownership, membership and a strict valid payload", async () => {
    const body = { tuneId: tunes[0].id, oftenPlayed: true };
    state.user = null;
    expect((await popularity(request(body), context(bookId))).status).toBe(401);
    state.user = viewer;
    expect((await popularity(request(body), context(bookId))).status).toBe(404);
    state.user = owner;
    expect((await popularity(request({ ...body, tuneId: tunes[3].id }), context(bookId))).status).toBe(404);
    expect((await popularity(request({ ...body, tuneId: randomUUID() }), context(bookId))).status).toBe(404);
    expect((await popularity(request(body), context(randomUUID()))).status).toBe(404);
    expect((await popularity(request(body), context("invalid"))).status).toBe(400);
    for (const invalid of [{ ...body, oftenPlayed: "true" }, { ...body, tuneId: 100 }, { ...body, userId: viewer.id }, { tuneId: tunes[0].id }, {}]) {
      expect((await popularity(request(invalid), context(bookId))).status).toBe(400);
    }
    expect(await state.db.select().from(bookPopularTunes)).toHaveLength(0);
  });
  it("removes session markers when the book is deleted", async () => {
    await updateBookPopularity(owner.id, bookId, tunes[0].id, true);
    await state.db.delete(tunebooks).where(eq(tunebooks.id, bookId));
    expect(await state.db.select().from(bookPopularTunes)).toHaveLength(0);
  });
});
