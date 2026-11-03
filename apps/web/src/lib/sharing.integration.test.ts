import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { bookShares, bookEntries, savedTunes, tunebooks } from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown as NodePgDatabase, user: null as typeof user.$inferSelect | null }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/session", () => ({ currentUser: async () => state.user }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { getBook, getLibrary } from "./library";
import { sendEmail } from "./email";
import { GET as sharingSettings, POST as share } from "@/app/api/books/[id]/sharing/route";
import { POST as save } from "@/app/api/books/[id]/save/route";
import { POST as mutateLibrary } from "@/app/api/library/route";

// Opt-in tests run real queries and migrations in a temporary schema, never the app's tables.
describe.skipIf(!process.env.TEST_DATABASE_URL)("tunebook sharing (PostgreSQL)", () => {
  const schema = `sharing_test_${randomUUID().replaceAll("-", "")}`;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  let owner: typeof user.$inferSelect, viewer: typeof user.$inferSelect, stranger: typeof user.$inferSelect;
  let book: typeof tunebooks.$inferSelect, otherBook: typeof tunebooks.$inferSelect;
  let tune: typeof savedTunes.$inferSelect, otherTune: typeof savedTunes.$inferSelect;
  const context = () => ({ params: Promise.resolve({ id: book.id }) });
  const request = (body: unknown) => new Request("http://localhost:3000/api/books/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    state.db = drizzle(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    for (const file of (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort()) {
      const migration = (await readFile(`drizzle/${file}`, "utf8")).replaceAll('"public".', `"${schema}".`);
      await pool.query(migration);
    }
    [owner, viewer, stranger] = await state.db.insert(user).values([
      { id: "owner", name: "Owner", email: "owner@example.com", emailVerified: true },
      { id: "viewer", name: "Viewer", email: "Viewer@example.com", emailVerified: true },
      { id: "stranger", name: "Stranger", email: "stranger@example.com", emailVerified: true },
    ]).returning();
    [book, otherBook] = await state.db.insert(tunebooks).values([{ userId: owner.id, name: "Session set", emoji: "🎻" }, { userId: owner.id, name: "Private set" }]).returning();
    [tune, otherTune] = await state.db.insert(savedTunes).values([
      { userId: owner.id, settingId: 1, tuneId: 1, title: "First tune", abc: "X:1\nT:First tune\nM:4/4\nL:1/8\nK:D\nDEFG ABcd|", sourceUrl: "https://thesession.org/tunes/1#setting1" },
      { userId: owner.id, settingId: 2, tuneId: 2, title: "Private tune", abc: "X:1\nK:D\nDEFG|", sourceUrl: "https://thesession.org/tunes/2#setting2" },
    ]).returning();
    await state.db.insert(bookEntries).values([{ bookId: book.id, tuneId: tune.id, position: 0 }, { bookId: otherBook.id, tuneId: otherTune.id, position: 0 }]);
  }, 30000);

  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });

  it("keeps new books private and validates ids", async () => {
    expect((await getBook(owner.id, book.id))?.tunes.map(({ tune }) => tune.title)).toEqual(["First tune"]);
    expect(await getBook(null, book.id)).toBeNull();
    expect(await getBook(stranger.id, book.id)).toBeNull();
    expect(await getBook(owner.id, "invalid")).toBeNull();
    state.user = null;
    expect((await sharingSettings(request(null), context())).status).toBe(401);
    expect((await share(request({ operation: "visibility", linkVisible: true }), context())).status).toBe(401);
  });

  it("normalizes email invitations, deduplicates them, and hides settings from viewers", async () => {
    state.user = owner;
    expect((await share(request({ operation: "invite", email: "VIEWER@example.com" }), context())).status).toBe(200);
    expect((await share(request({ operation: "invite", email: "viewer@example.com" }), context())).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await getBook(viewer.id, book.id)).not.toBeNull();
    expect((await getLibrary(viewer.id)).sharedBooks.map((book) => book.id)).toEqual([book.id]);
    expect((await getLibrary(owner.id)).sharedBooks).toEqual([]);
    state.user = viewer;
    expect((await sharingSettings(request(null), context())).status).toBe(404);
    expect((await share(request({ operation: "visibility", linkVisible: true }), context())).status).toBe(404);
    expect((await mutateLibrary(request({ operation: "renameBook", bookId: book.id, name: "Changed" }))).status).toBe(400);
    expect((await mutateLibrary(request({ operation: "removeFromBook", bookId: book.id, tuneId: tune.id }))).status).toBe(400);
    expect((await mutateLibrary(request({ operation: "setBookEmoji", bookId: book.id, emoji: "🎵" }))).status).toBe(400);
    expect((await getBook(owner.id, book.id))?.book.name).toBe("Session set");
  });

  it("requires email verification and supports invitations before account creation", async () => {
    await state.db.update(user).set({ emailVerified: false }).where(eq(user.id, viewer.id));
    expect(await getBook(viewer.id, book.id)).toBeNull();
    expect((await getLibrary(viewer.id)).sharedBooks).toEqual([]);
    await state.db.update(user).set({ emailVerified: true }).where(eq(user.id, viewer.id));
    state.user = owner;
    await share(request({ operation: "invite", email: "future@example.com" }), context());
    const [future] = await state.db.insert(user).values({ id: "future", name: "Future", email: "future@example.com", emailVerified: true }).returning();
    expect(await getBook(future.id, book.id)).not.toBeNull();
    expect((await getLibrary(future.id)).sharedBooks.map((book) => book.id)).toEqual([book.id]);
  });

  it("enables public access to just the selected book and revokes it", async () => {
    state.user = owner;
    expect((await share(request({ operation: "visibility", linkVisible: true }), context())).status).toBe(200);
    expect((await getBook(null, book.id))?.tunes.map(({ tune }) => tune.id)).toEqual([tune.id]);
    expect(await getBook(null, otherBook.id)).toBeNull();
    expect(await getBook(stranger.id, book.id)).not.toBeNull();
    await share(request({ operation: "remove", email: viewer.email.toLowerCase() }), context());
    expect((await getLibrary(viewer.id)).sharedBooks).toEqual([]);
    expect(await getBook(viewer.id, book.id)).not.toBeNull();
    await share(request({ operation: "visibility", linkVisible: false }), context());
    expect(await getBook(null, book.id)).toBeNull();
    expect(await getBook(viewer.id, book.id)).toBeNull();
    await share(request({ operation: "invite", email: viewer.email.toLowerCase() }), context());
  });

  it("preserves granted access if notification delivery fails and rejects invalid settings", async () => {
    state.user = owner;
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP unavailable"));
    const result = await share(request({ operation: "invite", email: stranger.email }), context());
    expect((await result.json()).warning).toContain("Access granted");
    expect(await getBook(stranger.id, book.id)).not.toBeNull();
    for (const body of [{ operation: "visibility", linkVisible: "true" }, { operation: "invite", email: "invalid" }, null]) {
      expect((await share(request(body), context())).status).toBe(400);
    }
    expect((await share(request({ operation: "invite", email: owner.email }), context())).status).toBe(400);
  });

  it("saves snapshots without exposing other tunes or overwriting existing personal settings", async () => {
    state.user = viewer;
    expect((await save(request({ operation: "tune", tuneId: otherTune.id }), context())).status).toBe(404);
    const first = await save(request({ operation: "tune", tuneId: tune.id }), context());
    const { tuneId } = await first.json();
    await state.db.update(savedTunes).set({ title: "My own title" }).where(eq(savedTunes.id, tuneId));
    expect((await save(request({ operation: "tune", tuneId: tune.id }), context())).status).toBe(200);
    const copies = await state.db.select().from(savedTunes).where(and(eq(savedTunes.userId, viewer.id), eq(savedTunes.settingId, tune.settingId)));
    expect(copies).toHaveLength(1);
    expect(copies[0].title).toBe("My own title");
    const { bookId } = await (await save(request({ operation: "book" }), context())).json();
    const copy = await getBook(viewer.id, bookId);
    expect(copy?.book.linkVisible).toBe(false);
    expect(copy?.book.emoji).toBe("🎻");
    expect(copy?.tunes.map(({ tune }) => tune.id)).toEqual([tuneId]);
    expect(await getBook(owner.id, bookId)).toBeNull();
    state.user = owner;
    await share(request({ operation: "remove", email: viewer.email.toLowerCase() }), context());
    expect(await getBook(viewer.id, book.id)).toBeNull();
    expect(await getBook(viewer.id, bookId)).not.toBeNull();
    state.user = null;
    expect((await save(request({ operation: "book" }), context())).status).toBe(401);
  });

  it("cascades sharing grants when the owner deletes a book", async () => {
    await state.db.delete(tunebooks).where(eq(tunebooks.id, book.id));
    expect(await state.db.select().from(bookShares).where(eq(bookShares.bookId, book.id))).toEqual([]);
  });
});
