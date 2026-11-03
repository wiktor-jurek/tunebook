import { notFound } from "next/navigation";
import { ArrowLeft, BookOpenText } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSavedTune } from "@/lib/library";
import { Score } from "@/components/score";
import { TuneActions } from "@/components/tune-actions";
import { getDefaultSound } from "@/lib/preferences";
import { getPlayalongs } from "@/lib/playalongs";
import { getMode } from "@/lib/mode";
import { keyName } from "@/lib/notation";
import { SessionBook, SessionScore } from "@/components/session-book";
import { Button } from "@/components/ui/button";
import { displayTitle } from "@/lib/titles";

export default async function TunePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ id }, { view }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const [tune, defaultSound] = await Promise.all([getSavedTune(user.id, id), getDefaultSound(user.id)]);
  if (!tune) notFound();
  const playalongs = await getPlayalongs(tune.settingId);
  if ((await getMode()).mode === "session") return <div className="session-screen"><h1 className="session-title">{displayTitle(tune.title)}</h1><p className="session-row-meta">{[tune.kind, keyName(tune.mode)].filter(Boolean).join(", ")}</p><SessionScore tune={tune} playback={{ id: tune.id, playalongs, defaultSound }} /></div>;
  // Reader: this tune full screen (a tablet or laptop on a music stand), with the player island.
  if (view === "reader") return <main className="book-reader"><SessionBook name={displayTitle(tune.title)} closeLabel="Back" sections={[{ kind: "tune", entryId: tune.id, tune: { ...tune, oftenPlayed: false } }]} playalongs={{ [tune.settingId]: playalongs }} defaultSound={defaultSound} closeHref={`/tunes/${id}`} /></main>;
  return <div className="page-wrap tune-page"><nav className="page-bar"><Link className="back-link" href="/"><ArrowLeft size={15} /> Tunes</Link><div className="page-bar-actions"><Button asChild variant="outline" size="sm"><Link href={`/tunes/${id}?view=reader`}><BookOpenText size={15} /> Reader</Link></Button><TuneActions tuneId={tune.id} title={displayTitle(tune.title)} labelled /></div></nav><Score tune={tune} defaultSound={defaultSound} playalongs={playalongs} hotkeys /></div>;
}
