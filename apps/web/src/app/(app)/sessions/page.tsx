import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getMode } from "@/lib/mode";
import { listRecordings, recordingLength, recordingTitle } from "@/lib/recordings";
import { sessionMonth } from "@/lib/session-names";
import { LocalTime, SessionName } from "@/components/local-time";
import { RecordingsList } from "@/components/recordings-list";
import { displayTitle } from "@/lib/titles";
import { AccountButton } from "@/components/session-shell";

// "The Kesh, Out On The Ocean and 2 more"
const tunePreview = (titles: string[], count: number) => titles.map(displayTitle).join(", ") + (count > titles.length ? ` and ${count - titles.length} more` : "");
const percent = (ms: number, of: number) => `${of > 0 ? Math.min(100, Math.max(0, (100 * ms) / of)) : 0}%`;

export const metadata = { title: "Sessions" };

// The sessions you recorded, by month, each named for when it was ("Last night") and with its tunes as a coloured bar,
// one colour per tune in turn, as the phone apps and the live waveform show them.
export default async function Sessions() {
  const user = await requireUser();
  const [recordings, { mode }] = await Promise.all([listRecordings(user.id), getMode()]);
  const session = mode === "session";
  const empty = <div className="sessions-welcome">
    <h2>No sessions yet</h2>
    <p>{session ? "Next time the tunes start, open the tray below and tap record. Every tune is named as it's played, and the setlist waits for you here."
      : "Next time the tunes start, open the tune finder in the bottom corner and tap record, or record on your phone. Every tune is named as it's played, and the setlist waits for you here, ready to practise."}</p>
  </div>;
  const months = Map.groupBy(recordings, (r) => sessionMonth(r.recordedAt));
  return <div className={session ? "session-screen" : "page-wrap"}>
    <header className={session ? "session-title-row" : "page-head"}><h1 className={session ? "session-title" : undefined}>Sessions{!session && <span className="heading-count">{recordings.length}</span>}</h1>{session && <AccountButton />}</header>
    {recordings.length > 0 && <p className="sessions-lede">Every tune you heard, ready to play back and practise.</p>}
    <RecordingsList hasUploaded={recordings.length > 0} empty={empty}>{[...months].map(([month, rows]) => <section key={month}>
      <h2 className="session-group-title">{month}</h2>
      <ul className="session-group recordings-list">{rows.map((r) => {
        const order = [...new Set(r.segments.map((segment) => segment.tuneId))];
        const duration = r.durationMs ?? 0;
        return <li key={r.id}><Link className="session-row session-card" href={`/sessions/${r.id}`}>
          <span className="session-row-text">
            <span className="session-card-title"><SessionName iso={r.recordedAt.toISOString()} fallback={recordingTitle(r.recordedAt)} /><span className="session-card-length">{recordingLength(duration)}</span></span>
            <span className="session-row-meta">{recordingTitle(r.recordedAt)}<LocalTime iso={r.recordedAt.toISOString()} prefix=", " />, {r.tunes === 0 ? "no tunes named" : r.tunes === 1 ? "1 tune" : `${r.tunes} tunes`}</span>
            {r.tunes > 0 && <span className="session-card-tunes">{tunePreview(r.firstTunes, r.tunes)}</span>}
            <span className="session-bar" aria-hidden="true">{r.segments.map((segment) => <span key={`${segment.tuneId}-${segment.startMs}`} data-turn={order.indexOf(segment.tuneId) % 3}
              style={{ left: percent(segment.startMs, duration), width: percent((segment.endMs > segment.startMs ? segment.endMs : duration) - segment.startMs, duration) }} />)}</span>
          </span>
          <ChevronRight size={18} className="session-chevron" />
        </Link></li>;
      })}</ul>
    </section>)}</RecordingsList>
  </div>;
}
