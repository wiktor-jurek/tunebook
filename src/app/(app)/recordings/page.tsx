import Link from "next/link";
import { AudioLines, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { listRecordings, recordingLength, recordingTitle } from "@/lib/recordings";
import { LocalTime } from "@/components/local-time";
import { PendingRecordings } from "@/components/pending-recordings";
import { displayTitle } from "@/lib/titles";

// "The Kesh, Out On The Ocean and 2 more"
const tunePreview = (titles: string[], count: number) => titles.map(displayTitle).join(", ") + (count > titles.length ? ` and ${count - titles.length} more` : "");

export const metadata = { title: "Recordings" };


export default async function Recordings() {
  const user = await requireUser();
  const [recordings, { mode }] = await Promise.all([listRecordings(user.id), getMode()]);
  const session = mode === "session";
  const empty = <p className={session ? "session-empty" : "muted"}>{session ? "Expand the tray below and press record. The session uploads when you stop, with a setlist of the tunes it named." : "Open the tune finder in the bottom corner and press record, or record on your phone. The session uploads when you stop, with a setlist of the tunes it named, ready to practise here."}</p>;
  return <div className={session ? "session-screen" : "page-wrap"}>
    <header className={session ? undefined : "page-head"}><h1 className={session ? "session-title" : undefined}>Recordings{!session && <span className="heading-count">{recordings.length}</span>}</h1></header>
    <PendingRecordings session={session} />
    {recordings.length ? <ul className="session-group recordings-list">{recordings.map((r) => <li key={r.id}><Link className="session-row" href={`/recordings/${r.id}`}>
      <span className="session-row-emoji" aria-hidden="true"><AudioLines size={18} /></span>
      <span className="session-row-text"><span className="session-row-title">{recordingTitle(r.recordedAt)}<LocalTime iso={r.recordedAt.toISOString()} prefix=", " /></span><span className="session-row-meta">{recordingLength(r.durationMs)}, {r.tunes ? tunePreview(r.firstTunes, r.tunes) : "no tunes named"}</span></span><ChevronRight size={18} className="session-chevron" />
    </Link></li>)}</ul> : empty}
  </div>;
}
