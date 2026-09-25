"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { saveCatalogSetting } from "@/lib/library";

export async function importSetting(formData: FormData) {
  const user = await requireUser();
  const settingId = Number(formData.get("settingId"));
  if (!Number.isSafeInteger(settingId) || settingId < 1) throw new Error("Invalid setting");
  const id = await saveCatalogSetting(user.id, settingId);
  redirect(`/tunes/${id}`);
}
