// Creates the guides' official tunebooks under one account, shares them by link and prints their ids for
// GUIDE_BOOKS in src/lib/guides/index.ts. A book that already exists (same owner and name) is left alone,
// so its link never changes; delete it in the app first to rebuild it.
//   npx tsx scripts/seed-guide-books.ts owner@example.com
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { user } from "../src/db/auth-schema";
import { tunebooks } from "../src/db/schema";
import { addToBook, createBook } from "../src/lib/library-actions";
import { saveCatalogSetting } from "../src/lib/library";
import { createSetFromTunes } from "../src/lib/sets";
import { setLinkVisible } from "../src/lib/sharing";
import { FIRST_SESSION_IDS } from "../src/lib/guides/first-session";
import { guideData } from "../src/lib/guides";

// Sets per kind in the popular-sets book.
const SETS_PER_KIND = 3;

async function book(userId: string, name: string, emoji: string, fill: (bookId: string) => Promise<void>) {
  const [existing] = await db.select({ id: tunebooks.id }).from(tunebooks).where(and(eq(tunebooks.userId, userId), eq(tunebooks.name, name))).limit(1);
  if (existing) return { id: existing.id, created: false };
  const id = await createBook(userId, { name, emoji });
  await fill(id);
  await setLinkVisible(userId, id, true);
  return { id, created: true };
}

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("Usage: npx tsx scripts/seed-guide-books.ts owner@example.com");
  const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (!owner) throw new Error(`No account for ${email}`);
  const saved = new Map<number, string>();
  const save = async (tuneId: number) => {
    if (!saved.has(tuneId)) saved.set(tuneId, await saveCatalogSetting(owner.id, guideData.tunes[tuneId].settingId));
    return saved.get(tuneId)!;
  };

  const first = await book(owner.id, "First session tunes", "🎻", async (bookId) => {
    for (const tuneId of FIRST_SESSION_IDS) await addToBook(owner.id, { bookId, tuneId: await save(tuneId) });
  });
  const sets = await book(owner.id, "The most popular session sets", "🍀", async (bookId) => {
    for (const { sets: ranked } of guideData.popularSets) {
      // A tune sits in one set per tunebook, so a set reusing an earlier set's tune makes way for the next one.
      const used = new Set<number>();
      let added = 0;
      for (const set of ranked) {
        if (added === SETS_PER_KIND) break;
        if (set.tunes.some((id) => used.has(id))) continue;
        set.tunes.forEach((id) => used.add(id));
        const ids: string[] = [];
        for (const id of set.tunes) ids.push(await save(id));
        await createSetFromTunes(owner.id, bookId, ids);
        added++;
      }
    }
  });

  for (const [slug, result] of [["first-session-tunes", first], ["popular-session-sets", sets]] as const) {
    console.log(`${slug}: ${result.id}${result.created ? "" : " (already there, left as it was)"}`);
  }
  console.log("Put these ids in GUIDE_BOOKS (src/lib/guides/index.ts).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
