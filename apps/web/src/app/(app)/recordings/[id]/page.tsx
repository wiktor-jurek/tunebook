import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { getRecording, recordingLength, recordingTitle } from "@/lib/recordings";
import { RecordingPlayer } from "@/components/recording-player";

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!z.uuid().safeParse(id).success) notFound();
  const [recording, { mode }] = await Promise.all([getRecording(user.id, id), getMode()]);
  if (!recording) notFound();
  const session = mode === "session";
  return <div className={session ? "session-screen" : "page-wrap"}>
    {!session && <nav className="page-bar"><Link className="back-link" href="/recordings"><ArrowLeft size={15} /> Recordings</Link></nav>}
    <RecordingPlayer recording={recording} title={recordingTitle(recording.recordedAt)} length={recordingLength(recording.durationMs)} titleClass={session ? "session-title" : "recording-title"} />
  </div>;
}
