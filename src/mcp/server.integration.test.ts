import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { user } from "@/db/auth-schema";
import { catalogSettings, catalogTunes } from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as NodePgDatabase }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/server-analytics", () => ({ trackServer: vi.fn() }));

import { sendEmail } from "@/lib/email";
import { trackServer } from "@/lib/server-analytics";
import { createTuneCompanionServer } from "./server";

type Result = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };

async function connect(userId: string, canWrite = true) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createTuneCompanionServer({ userId, canWrite, client: "Test Agent" }).connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as Result;
    return { ...result, data: result.structuredContent as T, text: result.content[0]?.text ?? "" };
  };
  const ok = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) => {
    const result = await call<T>(name, args);
    if (result.isError) throw new Error(`${name} failed: ${result.text}`);
    return result;
  };
  return { client, call, ok };
}

// Opt-in tests run real queries and migrations in a temporary schema, never the app's tables.
describe.skipIf(!process.env.TEST_DATABASE_URL)("Tune Companion MCP server (PostgreSQL)", () => {
  const schema = `mcp_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  let owner: Awaited<ReturnType<typeof connect>>, stranger: Awaited<ReturnType<typeof connect>>;
  let bookId: string;

  beforeAll(async () => {
    state.db = drizzle(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const file of (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort()) {
      await pool.query((await readFile(`drizzle/${file}`, "utf8")).replaceAll('"public".', `"${schema}".`));
    }
    await state.db.insert(user).values([
      { id: "owner", name: "Owner", email: "owner@example.test", emailVerified: true },
      { id: "stranger", name: "Stranger", email: "stranger@example.test", emailVerified: true },
    ]);
    const setting = (settingId: number, tuneId: number, title: string, kind: string, mode: string, meter = "4/4") =>
      ({ settingId, tuneId, title, kind, mode, meter, abc: `X:1\nT:${title}\nK:${mode}\nDEFG|`, sourceUrl: `https://thesession.org/tunes/${tuneId}#setting${settingId}` });
    await state.db.insert(catalogSettings).values([
      setting(101, 1, "Drowsy Maggie", "reel", "Edorian"), setting(102, 1, "Drowsy Maggie", "reel", "Dmajor"),
      setting(201, 2, "Kesh, The", "jig", "Gmajor", "6/8"),
      setting(301, 3, "Silver Spear, The", "reel", "Dmajor"),
      setting(401, 4, "Merry Blacksmith, The", "reel", "Dmajor"),
      setting(501, 5, "Banish Misfortune", "jig", "Dmixolydian", "6/8"),
    ]);
    await state.db.insert(catalogTunes).values([{ tuneId: 1, tunebooks: 8000 }, { tuneId: 2, tunebooks: 7700 }, { tuneId: 3, tunebooks: 5000 }, { tuneId: 4, tunebooks: 6000 }]);
    owner = await connect("owner");
    stranger = await connect("stranger");
  }, 60000);
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });

  it("lists only read tools without the write scope, all tools with it", async () => {
    const reader = await connect("owner", false);
    const readNames = (await reader.client.listTools()).tools.map((tool) => tool.name);
    expect(readNames).toEqual(expect.arrayContaining(["libresession_search_catalog", "libresession_get_tunebook", "libresession_get_sharing"]));
    expect(readNames).not.toContain("libresession_build_tunebook");
    const tools = (await owner.client.listTools()).tools;
    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^libresession_[a-z_]+$/);
      expect(tool.annotations).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
    expect(tools.find((tool) => tool.name === "libresession_delete_tunebook")!.annotations!.destructiveHint).toBe(true);
  });

  it("searches the catalog by key, type and popularity, one row per tune", async () => {
    const reels = await owner.ok<{ tunes: { title: string; setting_id: number; mode: string }[]; total: number }>("libresession_search_catalog", { kind: "reel", tonic: "D", mode: "major" });
    expect(reels.data.tunes.map((tune) => tune.title)).toEqual(["Drowsy Maggie", "Merry Blacksmith, The", "Silver Spear, The"]);
    // The representative setting is the one in the requested key.
    expect(reels.data.tunes[0]).toMatchObject({ setting_id: 102, mode: "Dmajor" });
    const kesh = await owner.call<{ tunes: { tune_id: number }[] }>("libresession_search_catalog", { query: "The Kesh" });
    expect(kesh.data.tunes.map((tune) => tune.tune_id)).toEqual([2]);
    const firstPage = await owner.call("libresession_search_catalog", { limit: 2 });
    expect(firstPage.data).toMatchObject({ total: 5, count: 2, has_more: true, next_offset: 2 });
    const pastEnd = await owner.call("libresession_search_catalog", { offset: 10 });
    expect(pastEnd.data).toMatchObject({ total: 5, count: 0, has_more: false, next_offset: null });
    const tune = await owner.call<{ settings: unknown[]; tunebooks: number }>("libresession_get_tune", { tune: "https://thesession.org/tunes/1" });
    expect(tune.data.settings).toHaveLength(2);
    expect(tune.data.tunebooks).toBe(8000);
  });

  it("tracks every tool call and search for product analytics", async () => {
    vi.mocked(trackServer).mockClear();
    await owner.ok("libresession_search_catalog", { query: "The Kesh", kind: "jig" });
    await owner.call("libresession_get_tunebook", { book_id: randomUUID() });
    const events = vi.mocked(trackServer).mock.calls.map(([name, data, context]) => ({ name, data, userId: context?.userId }));
    expect(events).toEqual([
      { name: "catalog_searched", userId: "owner", data: expect.objectContaining({ source: "mcp", client: "Test Agent", query: "The Kesh", kind: "jig", result_count: 1, top_titles: "Kesh, The" }) },
      { name: "mcp_tool_called", userId: "owner", data: expect.objectContaining({ tool: "search_catalog", outcome: "success", client: "Test Agent", arg_query: "The Kesh", result_total: 1, result_titles: "Kesh, The" }) },
      { name: "mcp_tool_called", userId: "owner", data: expect.objectContaining({ tool: "get_tunebook", outcome: "error", error: expect.stringContaining("Tunebook not found") }) },
    ]);
    expect(events[1].data).not.toHaveProperty("arg_response_format");
  });

  it("builds a tunebook with sets in one call", async () => {
    const built = await owner.ok<{ book_id: string; url: string; set_count: number }>("libresession_build_tunebook", {
      name: "Session reels", emoji: "🎻",
      sections: [{ setting_ids: [102, 301] }, { setting_ids: [401] }, { setting_ids: [201, 501], set_name: "Jigs" }],
    });
    expect(built.isError).toBeFalsy();
    expect(built.data).toMatchObject({ set_count: 2 });
    expect(built.data.url).toMatch(new RegExp(`/books/${built.data.book_id}$`));
    bookId = built.data.book_id;
    const book = await owner.call<{ sections: { kind: string; name?: string; tunes: { title: string }[] }[]; tune_count: number }>("libresession_get_tunebook", { book_id: bookId });
    expect(book.data.tune_count).toBe(5);
    expect(book.data.sections.map((section) => [section.kind, section.name ?? section.tunes[0].title])).toEqual([
      ["set", "Drowsy Maggie / Silver Spear, The"], ["tune", "Merry Blacksmith, The"], ["set", "Jigs"],
    ]);
    expect(book.text).toContain("Session reels");
  }, 60000);

  it("edits, reorders, stars and ungroups entries", async () => {
    type Book = { sections: { entry_id: string; kind: string; set_id?: string; name?: string; tunes: { saved_tune_id: string; title: string; often_played?: boolean }[] }[] };
    const read = async () => (await owner.call<Book>("libresession_get_tunebook", { book_id: bookId })).data.sections;
    let sections = await read();
    const reordered = [...sections].reverse().map((section) => section.entry_id);
    expect((await owner.call("libresession_reorder_tunebook", { book_id: bookId, entry_ids: reordered })).isError).toBeFalsy();
    expect((await read()).map((section) => section.entry_id)).toEqual(reordered);
    const partial = await owner.call("libresession_reorder_tunebook", { book_id: bookId, entry_ids: reordered.slice(1) });
    expect(partial.isError).toBe(true);
    expect(partial.text).toContain("exactly once");

    sections = await read();
    const jigs = sections.find((section) => section.name === "Jigs")!;
    const renamed = await owner.call<{ name: string }>("libresession_update_set", { set_id: jigs.set_id, use_tune_names: true });
    expect(renamed.data.name).toBe("Kesh, The / Banish Misfortune");
    const swapped = await owner.call<{ name: string }>("libresession_update_set", { set_id: jigs.set_id, saved_tune_ids: [...jigs.tunes].reverse().map((tune) => tune.saved_tune_id) });
    expect(swapped.data.name).toBe("Banish Misfortune / Kesh, The");

    const star = jigs.tunes[0];
    expect((await owner.call("libresession_set_often_played", { book_id: bookId, saved_tune_id: star.saved_tune_id, often_played: true })).isError).toBeFalsy();
    expect((await read()).flatMap((section) => section.tunes).find((tune) => tune.saved_tune_id === star.saved_tune_id)!.often_played).toBe(true);

    expect((await owner.call("libresession_ungroup_set", { book_id: bookId, entry_id: jigs.entry_id })).isError).toBeFalsy();
    sections = await read();
    expect(sections.filter((section) => section.kind === "tune").map((section) => section.tunes[0].title)).toEqual(expect.arrayContaining(["Banish Misfortune", "Kesh, The"]));
    const single = sections.find((section) => section.kind === "tune")!;
    expect((await owner.call("libresession_remove_from_tunebook", { book_id: bookId, entry_id: single.entry_id })).isError).toBeFalsy();
    expect(await read()).toHaveLength(sections.length - 1);

    const added = await owner.call<{ added_tunes: string[] }>("libresession_add_to_tunebook", { book_id: bookId, tunes: [{ setting_id: 101 }] });
    expect(added.data.added_tunes).toHaveLength(1);
    const library = await owner.call<{ tunebooks: { id: string }[]; saved_tune_count: number }>("libresession_get_library");
    expect(library.data.tunebooks.map((book) => book.id)).toContain(bookId);
    expect(library.data.saved_tune_count).toBe(6);
  }, 30000);

  it("keeps other users' tunebooks private and errors actionable", async () => {
    const read = await stranger.call("libresession_get_tunebook", { book_id: bookId });
    expect(read.isError).toBe(true);
    expect(read.text).toContain("libresession_get_library");
    for (const [name, args] of [
      ["libresession_delete_tunebook", { book_id: bookId }],
      ["libresession_update_tunebook", { book_id: bookId, name: "Mine now" }],
      ["libresession_add_to_tunebook", { book_id: bookId, tunes: [{ setting_id: 201 }] }],
      ["libresession_set_link_visibility", { book_id: bookId, public: true }],
      ["libresession_share_tunebook", { book_id: bookId, email: "friend@example.test" }],
    ] as const) {
      const result = await stranger.call(name, args);
      expect(result.isError, name).toBe(true);
      expect(result.text, name).toContain("Tunebook not found");
    }
    expect((await owner.call<{ name: string }>("libresession_get_tunebook", { book_id: bookId })).data.name).toBe("Session reels");

    const missing = await owner.call("libresession_build_tunebook", { name: "Broken", sections: [{ setting_ids: [102] }, { setting_ids: [999999] }] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/was created but stopped partway: Setting not found in the catalog\. .*libresession_search_catalog/);
  }, 30000);

  it("shares by email and link", async () => {
    const invite = await owner.call("libresession_share_tunebook", { book_id: bookId, email: "Friend@Example.test" });
    expect(invite.isError).toBeFalsy();
    expect(sendEmail).toHaveBeenCalledWith("friend@example.test", "Owner shared a tunebook with you", expect.stringContaining(`/books/${bookId}`));
    await owner.call("libresession_set_link_visibility", { book_id: bookId, public: true });
    const sharing = await owner.call("libresession_get_sharing", { book_id: bookId });
    expect(sharing.data).toMatchObject({ link_visible: true, emails: ["friend@example.test"] });
    await owner.call("libresession_share_tunebook", { book_id: bookId, email: "friend@example.test", action: "remove" });
    expect((await owner.call("libresession_get_sharing", { book_id: bookId })).data).toMatchObject({ emails: [] });
  });

  it("deletes tunebooks", async () => {
    expect((await owner.call("libresession_delete_tunebook", { book_id: bookId })).isError).toBeFalsy();
    expect((await owner.call("libresession_get_tunebook", { book_id: bookId })).isError).toBe(true);
  });
});
