import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { Sidebar } from "@/components/sidebar";
import { getDefaultSound } from "@/lib/preferences";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [library, defaultSound] = await Promise.all([getLibrary(user.id), getDefaultSound(user.id)]);
  return <div className="app-shell"><Sidebar library={library} userName={user.name} defaultSound={defaultSound} /><main className="main-content">{children}</main></div>;
}
