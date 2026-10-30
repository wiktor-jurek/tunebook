"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { SessionScore } from "@/components/session-book";

type Tune = { title: string; kind: string | null; meter: string | null; mode: string | null; abc: string };

/** A tune's whole score over everything else, for reading it on a music stand; closes with Escape or Done. */
export function ScoreSheet({ tune, title, meta, note, actions, onClose }: { tune: Tune; title: string; meta: string; note?: string; actions?: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    let lock: WakeLockSentinel | null = null;
    void navigator.wakeLock?.request("screen").then((next) => { lock = next; }).catch(() => undefined);
    return () => { window.removeEventListener("keydown", onKey); void lock?.release().catch(() => undefined); };
  }, [onClose]);
  return <div className="session-reader score-sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
    <header className="session-reader-bar"><span className="session-reader-tune score-sheet-title">{title}</span><button type="button" className="session-back" onClick={onClose}><X size={20} /> <span>Done</span></button></header>
    <article className="session-page score-sheet-page">
      <h2>{title}</h2><p className="session-row-meta">{meta}</p>
      {actions && <div className="score-sheet-actions">{actions}</div>}
      <SessionScore tune={tune} />
      {note && <p className="score-sheet-note">{note}</p>}
    </article>
  </div>;
}
