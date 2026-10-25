import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthClient } from "@/db/auth-schema";

const names = new Map<string, string>();

// Display names of registered OAuth clients (e.g. "Claude Code"), cached for the process lifetime.
export async function oauthClientName(clientId: string | undefined | null) {
  if (!clientId) return undefined;
  const cached = names.get(clientId);
  if (cached) return cached;
  try {
    const [client] = await db.select({ name: oauthClient.name }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
    const name = client?.name || "Unnamed client";
    names.set(clientId, name);
    return name;
  } catch { return undefined; }
}
