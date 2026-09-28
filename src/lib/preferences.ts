import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { DEFAULT_SOUND, isSound } from "@/lib/sounds";

export async function getDefaultSound(userId: string) {
  const [preferences] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return isSound(preferences?.defaultSound) ? preferences.defaultSound : DEFAULT_SOUND;
}
