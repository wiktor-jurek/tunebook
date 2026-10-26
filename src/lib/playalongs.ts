import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { playalongTracks } from "@/db/schema";
import { signedBlobUrl } from "@/lib/blob";

export type Playalong = { id: string; label: string; url: string; durationMs: number; bpm: number | null };

function withUrls(rows: (typeof playalongTracks.$inferSelect)[]): Playalong[] {
  return rows.flatMap((row) => {
    const url = signedBlobUrl(row.storageKey);
    return url ? [{ id: row.id, label: row.label, url, durationMs: row.durationMs, bpm: row.bpm }] : [];
  });
}

export async function getPlayalongs(settingId: number): Promise<Playalong[]> {
  return withUrls(await db.select().from(playalongTracks).where(eq(playalongTracks.settingId, settingId)).orderBy(asc(playalongTracks.label)));
}

// Play-alongs for every setting on a page, keyed by setting ID.
export async function getPlayalongsBySetting(settingIds: number[]): Promise<Record<number, Playalong[]>> {
  const ids = [...new Set(settingIds)];
  if (!ids.length) return {};
  const rows = await db.select().from(playalongTracks).where(inArray(playalongTracks.settingId, ids)).orderBy(asc(playalongTracks.label));
  const bySetting: Record<number, Playalong[]> = {};
  for (const row of rows) (bySetting[row.settingId] ??= []).push(...withUrls([row]));
  return bySetting;
}
