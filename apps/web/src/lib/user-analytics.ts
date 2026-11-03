import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { savedTunes, tunebooks } from "@/db/schema";
import { identifyServer, type EventData, type TrackContext } from "@/lib/server-analytics";

// Umami session properties for an account, so people can be looked up and segmented by who they are.
export async function userProfile(userId: string): Promise<EventData | null> {
  const [[account], [books], [tunes]] = await Promise.all([
    db.select({ name: user.name, email: user.email, verified: user.emailVerified, createdAt: user.createdAt }).from(user).where(eq(user.id, userId)).limit(1),
    db.select({ total: count() }).from(tunebooks).where(eq(tunebooks.userId, userId)),
    db.select({ total: count() }).from(savedTunes).where(eq(savedTunes.userId, userId)),
  ]);
  if (!account) return null;
  return {
    name: account.name, email: account.email, email_verified: account.verified,
    signed_up: account.createdAt.toISOString().slice(0, 10), tunebooks: books.total, saved_tunes: tunes.total,
  };
}

export async function identifyUser(userId: string, extra: EventData = {}, context: TrackContext = {}) {
  try {
    const profile = await userProfile(userId);
    if (profile) identifyServer(userId, { ...profile, ...extra }, context);
  } catch { /* Analytics must never interrupt the app. */ }
}
