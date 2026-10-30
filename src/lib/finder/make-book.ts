"use client";

async function post(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not make the tunebook");
  return result;
}

/** Saves each catalog setting not yet in the library, then puts them all, in order, into a new tunebook. Returns its id. */
export async function makeTunebook(name: string, settings: { settingId: number; savedId?: string | null }[], onSaved?: (settingId: number, savedId: string) => void) {
  const ids: string[] = [];
  for (const setting of settings) {
    let id = setting.savedId ?? null;
    if (!id) { id = (await post("/api/catalog", { settingId: setting.settingId })).tuneId as string; onSaved?.(setting.settingId, id); }
    if (!ids.includes(id)) ids.push(id);
  }
  const { bookId } = await post("/api/library", { operation: "createBook", name }) as { bookId: string };
  for (const tuneId of ids) await post("/api/library", { operation: "addToBook", bookId, tuneId });
  return { bookId, tunes: ids.length };
}
