import { currentUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { getMode } from "@/lib/mode";
import { Sidebar } from "@/components/sidebar";
import { SessionShell } from "@/components/session-shell";
import { AnalyticsIdentity } from "@/components/analytics-identity";
import { getDefaultSound } from "@/lib/preferences";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  // Guests reach only the public pages (the landing page and tune finder); every other page requires a user itself.
  if (!user) return children;
  const identity = <AnalyticsIdentity user={{ id: user.id, name: user.name, email: user.email }} />;
  const { mode, switchable } = await getMode();
  if (mode === "session") return <SessionShell switchable={switchable} userName={user.name}>{children}{identity}</SessionShell>;
  const [library, defaultSound] = await Promise.all([getLibrary(user.id), getDefaultSound(user.id)]);
  return <div className="app-shell"><Sidebar library={library} userName={user.name} defaultSound={defaultSound} /><main className="main-content">{children}</main>{identity}</div>;
}
