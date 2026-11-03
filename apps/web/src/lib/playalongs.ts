import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { catalogSettings, playalongTracks, type PlayalongTiming } from "@/db/schema";
import { signedBlobUrl } from "@/lib/blob";

// otherSetting: recorded from another setting of the same tune in the same key, close enough to play along to.
// timing maps the recording onto its own setting's score, so it is left off for other settings.
export type Playalong = { id: string; label: string; url: string; durationMs: number; bpm: number | null; otherSetting: boolean; timing: PlayalongTiming | null };

// Most settings have no recording of their own, while each tune's recordings come from one or two of its settings.
const OTHER_SETTINGS = 3;

type Row = typeof playalongTracks.$inferSelect & { mode: string | null };

function withUrl(row: Row, otherSetting: boolean): Playalong[] {
  const url = signedBlobUrl(row.storageKey);
  return url ? [{ id: row.id, label: row.label, url, durationMs: row.durationMs, bpm: row.bpm, otherSetting, timing: otherSetting ? null : row.timing }] : [];
}

export async function getPlayalongs(settingId: number): Promise<Playalong[]> {
  return (await getPlayalongsBySetting([settingId]))[settingId] ?? [];
}

// Play-alongs for every setting on a page, keyed by setting ID: the setting's own, then a few from
// other settings of the same tune in the same key.
export async function getPlayalongsBySetting(settingIds: number[]): Promise<Record<number, Playalong[]>> {
  const ids = [...new Set(settingIds)];
  if (!ids.length) return {};
  const settings = await db.select({ settingId: catalogSettings.settingId, tuneId: catalogSettings.tuneId, mode: catalogSettings.mode })
    .from(catalogSettings).where(inArray(catalogSettings.settingId, ids));
  if (!settings.length) return {};
  const rows: Row[] = await db.select({ track: playalongTracks, mode: catalogSettings.mode }).from(playalongTracks)
    .innerJoin(catalogSettings, eq(catalogSettings.settingId, playalongTracks.settingId))
    .where(inArray(playalongTracks.tuneId, [...new Set(settings.map((setting) => setting.tuneId))]))
    .orderBy(asc(playalongTracks.label))
    .then((result) => result.map(({ track, mode }) => ({ ...track, mode })));
  const bySetting: Record<number, Playalong[]> = {};
  for (const setting of settings) {
    const own = rows.filter((row) => row.settingId === setting.settingId).flatMap((row) => withUrl(row, false));
    const others = rows.filter((row) => row.tuneId === setting.tuneId && row.settingId !== setting.settingId && setting.mode !== null && row.mode === setting.mode)
      .slice(0, OTHER_SETTINGS).flatMap((row) => withUrl(row, true));
    if (own.length || others.length) bySetting[setting.settingId] = [...own, ...others];
  }
  return bySetting;
}
