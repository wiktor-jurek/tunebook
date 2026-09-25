import { requireUser } from "@/lib/session";
import { getLibrary } from "@/lib/library";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const library = await getLibrary(user.id);
  return <div className="app-shell"><Sidebar library={library} userName={user.name} /><main className="main-content">{children}</main></div>;
}
