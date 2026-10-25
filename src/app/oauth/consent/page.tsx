import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthClient } from "@/db/auth-schema";
import { requireUser } from "@/lib/session";
import { ConsentForm } from "@/components/consent-form";

const SCOPE_LABELS: Record<string, string> = {
  "tunebooks:read": "Search The Session and read your tunes, tunebooks, sets and sharing settings",
  "tunebooks:write": "Save tunes, create and edit tunebooks, folders and sets, delete them, and share tunebooks by email",
  openid: "Confirm who you are",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected until you revoke access",
};

// The signed query is verified by /oauth2/consent; this page only describes the request.
export default async function Consent({ searchParams }: { searchParams: Promise<{ client_id?: string; scope?: string }> }) {
  const user = await requireUser();
  const { client_id: clientId, scope } = await searchParams;
  const [client] = clientId ? await db.select({ name: oauthClient.name, uri: oauthClient.uri }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1) : [];
  const scopes = (scope ?? "").split(" ").filter(Boolean);
  return <ConsentForm clientName={client?.name || "An application"} clientUri={client?.uri ?? null} userName={user.name}
    permissions={scopes.map((name) => SCOPE_LABELS[name] ?? name)} />;
}
