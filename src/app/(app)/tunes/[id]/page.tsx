import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getSavedTune } from "@/lib/library";
import { Score } from "@/components/score";
import { TuneActions } from "@/components/tune-actions";
import { getDefaultSound } from "@/lib/preferences";

export default async function TunePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [tune, defaultSound] = await Promise.all([getSavedTune(user.id, id), getDefaultSound(user.id)]);
  if (!tune) notFound();
  return <div className="page-wrap tune-page"><Link className="back-link" href="/"><ArrowLeft size={15} /> All tunes</Link><Score tune={tune} defaultSound={defaultSound} /><TuneActions tuneId={tune.id} /></div>;
}
