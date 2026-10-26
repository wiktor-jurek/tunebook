import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { playalongTracks } from "@/db/schema";
import { signedBlobUrl } from "@/lib/blob";

export type Playalong = { id: string; label: string; url: string; durationMs: number; bpm: number | null };

export async function getPlayalongs(settingId: number): Promise<Playalong[]> {
  const rows = await db.select().from(playalongTracks).where(eq(playalongTracks.settingId, settingId)).orderBy(asc(playalongTracks.label));
  return rows.flatMap((row) => {
    const url = signedBlobUrl(row.storageKey);
    return url ? [{ id: row.id, label: row.label, url, durationMs: row.durationMs, bpm: row.bpm }] : [];
  });
}
