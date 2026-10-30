import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSavedTune } from "@/lib/library";
import { Score } from "@/components/score";
import { TuneActions } from "@/components/tune-actions";
import { getDefaultSound } from "@/lib/preferences";
import { getPlayalongs } from "@/lib/playalongs";
import { getMode } from "@/lib/mode";
import { keyName } from "@/lib/notation";
import { SessionScore } from "@/components/session-book";
import { displayTitle } from "@/lib/titles";

export default async function TunePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [tune, defaultSound] = await Promise.all([getSavedTune(user.id, id), getDefaultSound(user.id)]);
  if (!tune) notFound();
  if ((await getMode()).mode === "session") return <div className="session-screen"><h1 className="session-title">{displayTitle(tune.title)}</h1><p className="session-row-meta">{[tune.kind, keyName(tune.mode)].filter(Boolean).join(", ")}</p><SessionScore tune={tune} /></div>;
  const playalongs = await getPlayalongs(tune.settingId);
  return <div className="page-wrap tune-page"><nav className="page-bar"><Link className="back-link" href="/"><ArrowLeft size={15} /> Tunes</Link><TuneActions tuneId={tune.id} title={displayTitle(tune.title)} labelled /></nav><Score tune={tune} defaultSound={defaultSound} playalongs={playalongs} /></div>;
}
