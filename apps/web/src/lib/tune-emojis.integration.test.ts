import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { bookEntries, catalogSettings, savedTunes, tunebooks, tuneEmojiSuggestions } from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as NodePgDatabase, user: null as typeof user.$inferSelect | null }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => state.user }));
vi.mock("./smart-emoji", async (original) => {
  const actual = await original<typeof import("./smart-emoji")>();
  return { ...actual, suggestTuneEmoji: vi.fn(actual.suggestTuneEmoji) };
});

import { SMART_EMOJI_VERSION, suggestTuneEmoji } from "./smart-emoji";
import { getTuneEmojiSuggestion, withTuneEmojis } from "./tune-emojis";
import { getBook, getLibrary, getSavedTune, saveCatalogSetting } from "./library";
import { POST as changeEmoji } from "@/app/api/tunes/[id]/emoji/route";
import { POST as saveShared } from "@/app/api/books/[id]/save/route";

describe.skipIf(!process.env.TEST_DATABASE_URL)("cached tune emojis (PostgreSQL)", () => {
  const schema = `emojis_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  let owner: typeof user.$inferSelect, viewer: typeof user.$inferSelect;
  const request = (emoji: unknown) => new Request("http://localhost/api/tunes/emoji", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) });
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(async () => {
    state.db = drizzle(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const file of (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort()) await pool.query((await readFile(`drizzle/${file}`, "utf8")).replaceAll('"public".', `"${schema}".`));
    [owner, viewer] = await state.db.insert(user).values([{ id: "owner", name: "Owner", email: "owner@example.test", emailVerified: true }, { id: "viewer", name: "Viewer", email: "viewer@example.test", emailVerified: true }]).returning();
    await state.db.insert(catalogSettings).values([
      { settingId: 1, tuneId: 100, title: "Calliope House", abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/100" },
      { settingId: 2, tuneId: 100, title: "A different setting title", abc: "K:G\nGABc|", sourceUrl: "https://thesession.org/tunes/100" },
      { settingId: 3, tuneId: 101, title: "Garrett Barry's", abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/101" },
    ]);
  }, 30000);
  beforeEach(() => { vi.mocked(suggestTuneEmoji).mockClear(); state.user = owner; });
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });

  it("chooses one canonical suggestion for all settings and users on first save", async () => {
    const firstId = await saveCatalogSetting(owner.id, 2);
    const secondId = await saveCatalogSetting(viewer.id, 1);
    expect((await getSavedTune(owner.id, firstId))?.emoji).toBe("🏠");
    expect((await getSavedTune(viewer.id, secondId))?.emoji).toBe("🏠");
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
    expect(suggestTuneEmoji).toHaveBeenCalledWith("Calliope House");
    expect(await state.db.select().from(tuneEmojiSuggestions).where(eq(tuneEmojiSuggestions.tuneId, 100))).toHaveLength(1);
  });

  it("serializes concurrent first-time searches in PostgreSQL", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => getTuneEmojiSuggestion(200, "Father O'Flynn")));
    expect(results).toEqual(Array(6).fill("👴"));
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
    expect(await state.db.select().from(tuneEmojiSuggestions).where(eq(tuneEmojiSuggestions.tuneId, 200))).toHaveLength(1);
  });

  it("caches fallback results too and does not rerun matching after reuse", async () => {
    const tuneId = await saveCatalogSetting(owner.id, 3);
    await saveCatalogSetting(viewer.id, 3);
    await saveCatalogSetting(owner.id, 3);
    expect((await getSavedTune(owner.id, tuneId))?.emoji).toBe("🎵");
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
    expect(await getTuneEmojiSuggestion(101, "House renamed later")).toBe("🎵");
  });

  it("lazily fills existing saved tunes and deduplicates batch lookups", async () => {
    const [legacy] = await state.db.insert(savedTunes).values({ userId: owner.id, settingId: 50, tuneId: 300, title: "The Butterfly", abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/300" }).returning();
    expect((await withTuneEmojis([legacy, legacy])).map((tune) => tune.emoji)).toEqual(["🦋", "🦋"]);
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
    await getLibrary(owner.id);
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
  });

  it("keeps an override on only the owner's saved setting and preserves it on repeat saves", async () => {
    const id = await saveCatalogSetting(owner.id, 2);
    expect((await changeEmoji(request("🎻"), context(id))).status).toBe(200);
    await saveCatalogSetting(owner.id, 2);
    expect(await getSavedTune(owner.id, id)).toMatchObject({ emoji: "🎻", suggestedEmoji: "🏠", emojiOverride: "🎻" });
    const otherSetting = await saveCatalogSetting(owner.id, 1);
    expect((await getSavedTune(owner.id, otherSetting))?.emoji).toBe("🏠");
    expect((await getLibrary(viewer.id)).tunes.find((tune) => tune.tuneId === 100)?.emoji).toBe("🏠");
    expect(suggestTuneEmoji).not.toHaveBeenCalled();
  });

  it("enforces ownership and validates complex Unicode emojis", async () => {
    const id = await saveCatalogSetting(owner.id, 2);
    state.user = null;
    expect((await changeEmoji(request("🏠"), context(id))).status).toBe(401);
    state.user = viewer;
    expect((await changeEmoji(request("🏠"), context(id))).status).toBe(404);
    state.user = owner;
    for (const invalid of ["text", "🏠🏠", "1", "", "<script>", 1, {}]) expect((await changeEmoji(request(invalid), context(id))).status).toBe(400);
    expect((await changeEmoji(request("👍🏽"), context("invalid"))).status).toBe(400);
    expect((await changeEmoji(request("🧙‍♀️"), context(id))).status).toBe(200);
    expect((await getSavedTune(owner.id, id))?.emoji).toBe("🧙‍♀️");
  });

  it("shows owner icons publicly and copies overrides without replacing an existing personal choice", async () => {
    const id = await saveCatalogSetting(owner.id, 2);
    const [book] = await state.db.insert(tunebooks).values({ userId: owner.id, name: "Shared book", linkVisible: true }).returning();
    await state.db.insert(bookEntries).values({ bookId: book.id, tuneId: id, position: 0 });
    expect((await getBook(null, book.id))?.tunes[0].tune.emoji).toBe("🧙‍♀️");
    state.user = viewer;
    const body = () => new Request("http://localhost/api/books/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "tune", tuneId: id }) });
    const copied = await (await saveShared(body(), context(book.id))).json();
    expect((await getSavedTune(viewer.id, copied.tuneId))?.emoji).toBe("🧙‍♀️");
    await changeEmoji(request("🐈"), context(copied.tuneId));
    await saveShared(body(), context(book.id));
    expect((await getSavedTune(viewer.id, copied.tuneId))?.emoji).toBe("🐈");
    expect((await getSavedTune(owner.id, id))?.emoji).toBe("🧙‍♀️");
  });

  it("resets to the cached default without recomputing it or changing other copies", async () => {
    const id = await saveCatalogSetting(owner.id, 2);
    expect((await changeEmoji(request(null), context(id))).status).toBe(200);
    expect(await getSavedTune(owner.id, id)).toMatchObject({ emoji: "🏠", suggestedEmoji: "🏠", emojiOverride: null });
    expect(suggestTuneEmoji).not.toHaveBeenCalled();
  });

  it("retains the global cache when a saved copy is deleted", async () => {
    const id = await saveCatalogSetting(owner.id, 3);
    await state.db.delete(savedTunes).where(and(eq(savedTunes.userId, owner.id), eq(savedTunes.id, id)));
    await saveCatalogSetting(owner.id, 3);
    expect(suggestTuneEmoji).not.toHaveBeenCalled();
  });

  it("refreshes stale keyword defaults once across concurrent readers and keeps personal overrides", async () => {
    const [legacy] = await state.db.insert(savedTunes).values({ userId: owner.id, settingId: 60, tuneId: 400, title: "The Stallion", emojiOverride: "🎻", abc: "K:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/400" }).returning();
    const oldDate = new Date("2020-01-01T00:00:00Z");
    await state.db.insert(tuneEmojiSuggestions).values({ tuneId: 400, emoji: "🎵", matcherVersion: "emojilib-4.0.3-v1", createdAt: oldDate });
    const [batch, ...suggestions] = await Promise.all([
      withTuneEmojis([legacy, legacy]),
      ...Array.from({ length: 5 }, () => getTuneEmojiSuggestion(400, "The Stallion")),
    ]);
    expect(batch).toEqual([expect.objectContaining({ emoji: "🎻", suggestedEmoji: "🐎" }), expect.objectContaining({ emoji: "🎻", suggestedEmoji: "🐎" })]);
    expect(suggestions).toEqual(Array(5).fill("🐎"));
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
    const [cache] = await state.db.select().from(tuneEmojiSuggestions).where(eq(tuneEmojiSuggestions.tuneId, 400));
    expect(cache).toMatchObject({ emoji: "🐎", matcherVersion: SMART_EMOJI_VERSION });
    expect(cache.createdAt.getTime()).toBeGreaterThan(oldDate.getTime());
    expect((await getSavedTune(owner.id, legacy.id))?.emojiOverride).toBe("🎻");
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(1);
  });

  it("does not persist a failed inference and retries on the next request", async () => {
    vi.mocked(suggestTuneEmoji).mockRejectedValueOnce(new Error("Model unavailable"));
    await expect(getTuneEmojiSuggestion(500, "The Seamstress")).rejects.toThrow("Model unavailable");
    expect(await state.db.select().from(tuneEmojiSuggestions).where(eq(tuneEmojiSuggestions.tuneId, 500))).toHaveLength(0);
    expect(await getTuneEmojiSuggestion(500, "The Seamstress")).toBe("🪡");
    expect(suggestTuneEmoji).toHaveBeenCalledTimes(2);
  });
});
