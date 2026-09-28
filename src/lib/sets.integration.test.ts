import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { and, asc, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { bookEntries, savedTunes, setTunes, tunebooks, tuneSets } from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as NodePgDatabase, user: null as typeof user.$inferSelect | null }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => state.user }));

import { addSet, changeEntry, deleteSet, editSet, getMySets, getOftenPlayedWith, groupTunes, moveSetTune } from "./sets";
import { getBook } from "./library";
import { POST as setsRoute } from "@/app/api/sets/route";
import { POST as libraryRoute } from "@/app/api/library/route";
import { POST as saveBook } from "@/app/api/books/[id]/save/route";

describe.skipIf(!process.env.TEST_DATABASE_URL)("ordered reusable sets (PostgreSQL)", () => {
  const schema = `sets_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  let owner: typeof user.$inferSelect, stranger: typeof user.$inferSelect;
  let tunes: (typeof savedTunes.$inferSelect)[], sourceId: string, secondId: string, privateId: string;
  let setId: string;
  const legacySetId = randomUUID();
  const request = (body: unknown) => new Request("http://localhost:3000/api/sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const book = (id = sourceId) => getBook(owner.id, id);
  const titles = async (id = sourceId) => (await book(id))!.tunes.map(({ tune }) => tune.title);

  beforeAll(async () => {
    state.db = drizzle(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const migrations = (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort();
    const migrate = async (file: string) => pool.query((await readFile(`drizzle/${file}`, "utf8")).replaceAll('"public".', `"${schema}".`));
    for (const file of migrations.filter((file) => file < "0004")) await migrate(file);
    [owner, stranger] = await state.db.insert(user).values([{ id: "owner", name: "Owner", email: "owner@example.test", emailVerified: true }, { id: "stranger", name: "Stranger", email: "stranger@example.test", emailVerified: true }]).returning();
    const books = await state.db.insert(tunebooks).values([{ userId: owner.id, name: "Original book", linkVisible: true }, { userId: owner.id, name: "Second book" }, { userId: stranger.id, name: "Private book" }]).returning();
    [sourceId, secondId, privateId] = books.map((book) => book.id);
    // Seed with SQL so this test still exercises the schema before newer tune columns exist.
    for (const [position, title] of ["A", "B", "C", "D"].entries()) {
      const tuneId = randomUUID();
      await pool.query("INSERT INTO saved_tunes (id,user_id,setting_id,tune_id,title,abc,source_url) VALUES ($1,$2,$3,$3,$4,$5,$6)", [tuneId, owner.id, position + 1, title, "X:1\nK:D\nDEFG|", `https://thesession.org/tunes/${position + 1}`]);
      await pool.query("INSERT INTO book_tunes (book_id,tune_id,position) VALUES ($1,$2,$3)", [sourceId, tuneId, position]);
    }
    for (const file of migrations.filter((file) => file >= "0004")) {
      if (file.startsWith("0006")) await pool.query("INSERT INTO tune_sets (id,user_id,name) VALUES ($1,$2,$3)", [legacySetId, owner.id, "An existing custom name"]);
      await migrate(file);
    }
    tunes = await state.db.select().from(savedTunes).where(eq(savedTunes.userId, owner.id)).orderBy(asc(savedTunes.settingId));
  }, 30000);
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });

  it("migrates existing individual tunes without changing their order", async () => {
    expect(await titles()).toEqual(["A", "B", "C", "D"]);
    expect((await book())!.sections.every((section) => section.kind === "tune" && !!section.entryId)).toBe(true);
    const [legacy] = await state.db.select().from(tuneSets).where(eq(tuneSets.id, legacySetId));
    expect(legacy).toMatchObject({ name: "An existing custom name", autoName: false });
    await state.db.delete(tuneSets).where(eq(tuneSets.id, legacySetId));
  });

  it("groups chosen entries in their specified order at the first selected position", async () => {
    const sections = (await book())!.sections;
    setId = await groupTunes(owner.id, sourceId, "My jigs", [sections[2].entryId, sections[0].entryId]);
    expect(await titles()).toEqual(["C", "A", "B", "D"]);
    const grouped = (await book())!.sections;
    expect(grouped.map((section) => section.kind)).toEqual(["set", "tune", "tune"]);
    expect(grouped[0]).toMatchObject({ setId, name: "My jigs" });
    expect((await getMySets(owner.id))[0].books.map((book) => book.id)).toEqual([sourceId]);
  });

  it("adds a reusable set and absorbs existing individual members without duplicates", async () => {
    await state.db.insert(bookEntries).values([{ bookId: secondId, tuneId: tunes[0].id, position: 0 }, { bookId: secondId, tuneId: tunes[1].id, position: 1 }]);
    await addSet(owner.id, secondId, setId);
    expect(await titles(secondId)).toEqual(["B", "C", "A"]);
    expect((await getMySets(owner.id))[0].books).toHaveLength(2);
    await expect(addSet(owner.id, secondId, setId)).rejects.toThrow("already in");
  });

  it("moves sets as a unit and updates internal order across linked books", async () => {
    const placement = (await book(secondId))!.sections.find((section) => section.kind === "set")!;
    await changeEntry(owner.id, secondId, placement.entryId, "up");
    expect(await titles(secondId)).toEqual(["C", "A", "B"]);
    await moveSetTune(owner.id, setId, tunes[0].id, "up");
    expect(await titles()).toEqual(["A", "C", "B", "D"]);
    expect(await titles(secondId)).toEqual(["A", "C", "B"]);
    await editSet(owner.id, setId, "Renamed set", [tunes[3].id, tunes[2].id, tunes[0].id]);
    expect((await book(secondId))!.sections[0]).toMatchObject({ name: "Renamed set" });
    expect(await titles(secondId)).toEqual(["D", "C", "A", "B"]);
    expect(await titles()).toEqual(["D", "C", "A", "B", "D"]);
    expect(new Set((await book())!.tunes.map((row) => row.instanceId)).size).toBe(5);
  });

  it("counts tune relationships once per set rather than once per linked book", async () => {
    expect((await getOftenPlayedWith(owner.id, tunes[0].tuneId)).rows).toEqual([{ tuneId: 3, setCount: 1 }, { tuneId: 4, setCount: 1 }]);
  });

  it("shares grouped contents and saves private set copies with the same playing order", async () => {
    const publicBook = await getBook(null, sourceId);
    expect(publicBook!.sections[0]).toMatchObject({ kind: "set", name: "Renamed set" });
    state.user = stranger;
    const response = await saveBook(request({ operation: "book" }), { params: Promise.resolve({ id: sourceId }) });
    expect(response.status).toBe(200);
    const { bookId: copyId } = await response.json();
    const copy = (await getBook(stranger.id, copyId))!;
    expect(copy.book.linkVisible).toBe(false);
    expect(copy.tunes.map(({ tune }) => tune.title)).toEqual(publicBook!.tunes.map(({ tune }) => tune.title));
    const copiedSet = copy.sections.find((section) => section.kind === "set")!;
    expect(copiedSet.kind === "set" && copiedSet.setId).not.toBe(setId);
    await editSet(owner.id, setId, "Updated original", [tunes[0].id, tunes[2].id]);
    expect((await getBook(stranger.id, copyId))!.sections[0]).toMatchObject({ name: "Renamed set" });
    expect((await getBook(stranger.id, copyId))!.tunes.map(({ tune }) => tune.title)).toEqual(["D", "C", "A", "B", "D"]);
    expect(await getBook(owner.id, copyId)).toBeNull();
  });

  it("rejects grouping private data, invalid membership and unauthenticated edits", async () => {
    state.user = null;
    expect((await setsRoute(request({ operation: "add", bookId: secondId, setId }))).status).toBe(401);
    state.user = stranger;
    for (const body of [{ operation: "add", bookId: privateId, setId }, { operation: "edit", setId, name: "Hijacked", tuneIds: [tunes[0].id, tunes[1].id] }, { operation: "delete", setId }]) {
      expect((await setsRoute(request(body))).status).toBe(400);
    }
    await expect(addSet(owner.id, privateId, setId)).rejects.toThrow("Tunebook not found");
    await expect(editSet(owner.id, setId, "Invalid", [tunes[0].id, tunes[0].id])).rejects.toThrow("different tunes");
    await expect(editSet(owner.id, setId, "Invalid", [tunes[0].id, randomUUID()])).rejects.toThrow("not in your library");
    state.user = owner;
    expect((await setsRoute(request({ operation: "edit", setId, name: "", tuneIds: [tunes[0].id] }))).status).toBe(400);
    expect((await libraryRoute(request({ operation: "deleteSavedTune", tuneId: tunes[0].id }))).status).toBe(400);
    expect((await getMySets(owner.id))[0].name).toBe("Updated original");
  });

  it("ungroups one placement without changing the reusable set or other books", async () => {
    const placement = (await book(secondId))!.sections.find((section) => section.kind === "set")!;
    await changeEntry(owner.id, secondId, placement.entryId, "ungroup");
    expect(await titles(secondId)).toEqual(["A", "C", "B"]);
    expect((await book(secondId))!.sections.every((section) => section.kind === "tune")).toBe(true);
    expect((await getMySets(owner.id))[0].books).toHaveLength(1);
    expect((await book())!.sections[0].kind).toBe("set");
  });

  it("keeps removed sets in My sets and can insert them again", async () => {
    const placement = (await book())!.sections.find((section) => section.kind === "set")!;
    await changeEntry(owner.id, sourceId, placement.entryId, "remove");
    expect(await titles()).toEqual(["B", "D"]);
    expect((await getMySets(owner.id))[0].books).toHaveLength(0);
    await addSet(owner.id, sourceId, setId);
    expect(await titles()).toEqual(["B", "D", "A", "C"]);
  });

  it("deletes a set definition while preserving tunes and order in linked books", async () => {
    const before = await titles();
    await deleteSet(owner.id, setId);
    expect(await titles()).toEqual(before);
    expect((await book())!.sections.every((section) => section.kind === "tune")).toBe(true);
    expect(await state.db.select().from(setTunes).where(eq(setTunes.setId, setId))).toEqual([]);
    expect(await state.db.select().from(tuneSets).where(eq(tuneSets.id, setId))).toEqual([]);
    expect((await state.db.select().from(savedTunes).where(and(eq(savedTunes.userId, owner.id), eq(savedTunes.id, tunes[0].id))))).toHaveLength(1);
  });

  it("retains cascading account cleanup with linked sets", async () => {
    const id = "departing-user";
    await state.db.insert(user).values({ id, name: "Departing", email: "departing@example.test" });
    const [book] = await state.db.insert(tunebooks).values({ userId: id, name: "Departing book" }).returning();
    const [set] = await state.db.insert(tuneSets).values({ userId: id, name: "Departing set" }).returning();
    const [tune] = await state.db.insert(savedTunes).values({ userId: id, settingId: 99, tuneId: 99, title: "Departing tune", abc: "K:D\nD3|", sourceUrl: "https://thesession.org/tunes/99" }).returning();
    await state.db.insert(setTunes).values({ setId: set.id, tuneId: tune.id, position: 0 });
    await state.db.insert(bookEntries).values({ bookId: book.id, setId: set.id, position: 0 });
    await state.db.delete(user).where(eq(user.id, id));
    expect(await state.db.select().from(tuneSets).where(eq(tuneSets.id, set.id))).toEqual([]);
  });

  it("defaults to slash-separated playing order, follows changes across books, and preserves the mode in shared copies", async () => {
    state.user = owner;
    const [autoBook] = await state.db.insert(tunebooks).values({ userId: owner.id, name: "Automatic names", linkVisible: true }).returning();
    const entries = await state.db.insert(bookEntries).values(tunes.slice(0, 3).map((tune, position) => ({ bookId: autoBook.id, tuneId: tune.id, position }))).returning();
    const grouped = await setsRoute(request({ operation: "group", bookId: autoBook.id, entryIds: [entries[2].id, entries[0].id] }));
    expect(grouped.status).toBe(200);
    const { setId: autoSetId } = await grouped.json();
    expect((await book(autoBook.id))!.sections[0]).toMatchObject({ name: "C / A", autoName: true });
    await addSet(owner.id, secondId, autoSetId);
    await moveSetTune(owner.id, autoSetId, tunes[0].id, "up");
    expect((await getMySets(owner.id)).find((set) => set.id === autoSetId)?.name).toBe("A / C");
    expect((await book(secondId))!.sections.find((section) => section.kind === "set")).toMatchObject({ name: "A / C", autoName: true });
    expect((await getBook(null, autoBook.id))!.sections[0]).toMatchObject({ name: "A / C" });
    state.user = stranger;
    const response = await saveBook(request({ operation: "book" }), { params: Promise.resolve({ id: autoBook.id }) });
    expect(response.status).toBe(200);
    const { bookId: copyId } = await response.json();
    const copiedSet = (await getBook(stranger.id, copyId))!.sections[0];
    expect(copiedSet).toMatchObject({ name: "A / C", autoName: true });
    if (copiedSet.kind !== "set") throw new Error("Missing copied set");
    await moveSetTune(stranger.id, copiedSet.setId, copiedSet.tunes[1].id, "up");
    expect((await getBook(stranger.id, copyId))!.sections[0]).toMatchObject({ name: "C / A", autoName: true });
    expect((await book(autoBook.id))!.sections[0]).toMatchObject({ name: "A / C" });
    state.user = owner;
    const override = await setsRoute(request({ operation: "edit", setId: autoSetId, name: "Friday jigs", tuneIds: [tunes[0].id, tunes[2].id] }));
    expect(override.status).toBe(200);
    await moveSetTune(owner.id, autoSetId, tunes[2].id, "up");
    expect((await book(autoBook.id))!.sections[0]).toMatchObject({ name: "Friday jigs", autoName: false });
    expect((await getMySets(owner.id)).find((set) => set.id === autoSetId)?.name).toBe("Friday jigs");
    const reset = await setsRoute(request({ operation: "edit", setId: autoSetId, name: "", tuneIds: [tunes[2].id, tunes[0].id, tunes[1].id] }));
    expect(reset.status).toBe(200);
    expect((await book(autoBook.id))!.sections[0]).toMatchObject({ name: "C / A / B", autoName: true });
  }, 15000);

  it("keeps full generated names longer than the custom-name limit and validates custom overrides", async () => {
    const longTitle = "A long traditional tune title that should never be truncated in the name of its set";
    const [longTune] = await state.db.insert(savedTunes).values({ userId: owner.id, settingId: 101, tuneId: 101, title: longTitle, abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/101" }).returning();
    const [longBook] = await state.db.insert(tunebooks).values({ userId: owner.id, name: "Long names" }).returning();
    const entries = await state.db.insert(bookEntries).values([{ bookId: longBook.id, tuneId: longTune.id, position: 0 }, { bookId: longBook.id, tuneId: tunes[0].id, position: 1 }]).returning();
    state.user = owner;
    expect((await setsRoute(request({ operation: "group", bookId: longBook.id, name: "x".repeat(81), entryIds: entries.map((entry) => entry.id) }))).status).toBe(400);
    expect((await setsRoute(request({ operation: "group", bookId: longBook.id, name: "   ", entryIds: entries.map((entry) => entry.id) }))).status).toBe(200);
    expect((await book(longBook.id))!.sections[0]).toMatchObject({ name: `${longTitle} / A`, autoName: true });
  });
});
