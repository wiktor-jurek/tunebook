import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { SessionBookList } from "@/components/session-book-list";

export const metadata = { title: "Tunebooks" };

// Session mode's tunebook list (also its home). At home the sidebar lists the books, so practice mode goes back to Tunes.
export default async function Books() {
  const user = await requireUser();
  if ((await getMode()).mode !== "session") redirect("/");
  return <SessionBookList userId={user.id} />;
}
