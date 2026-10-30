import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { TuneFinder } from "@/components/tune-finder";
import { PublicHeader } from "@/components/public-header";

export const metadata = { title: "Tune finder", description: "Hold your phone up to a session and Tune Companion names the tune from a few seconds of playing. It listens on your device and uploads nothing." };

export default async function TuneFinderPage() {
  const user = await currentUser();
  // A signed-in phone listens from the tray on every screen; a second listener here would compete for the microphone.
  if (user && (await getMode()).mode === "session") redirect("/");
  const page = <div className="page-wrap finder-page"><h1 className="sr-only">Tune finder</h1><TuneFinder signedIn={!!user} /><p className="finder-footnote">Names over 23,000 tunes from The Session. <Link href="/tunes/finder/benchmark">How well it works</Link></p></div>;
  return user ? page : <div className="landing"><PublicHeader next="/tunes/finder" />{page}</div>;
}
