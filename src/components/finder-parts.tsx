"use client";

import { trackEvent } from "@/lib/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Bookmark, BookPlus, Check, Music, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpeningPhrase } from "@/components/opening-phrase";
import { ScoreSheet } from "@/components/score-sheet";
import type { FinderTune } from "@/lib/library";
import { keyName } from "@/lib/notation";
import { ABILITY_LABELS } from "@/lib/ability";
import { displayTitle } from "@/lib/titles";
import type { useTuneListener } from "@/lib/finder/use-listener";

// The pieces of the tune finder that the standalone finder (desktop, landing page) and the phone's listen tray share.

export type Listener = ReturnType<typeof useTuneListener>;
/** What every piece needs: the listener, whether someone is signed in, where sign-up returns to, and how to open a score. */
export type FinderContext = { listener: Listener; signedIn: boolean; next: string; onScore: (tune: FinderTune) => void };

export const meta = (tune: FinderTune) => [tune.kind, keyName(tune.mode)].filter(Boolean).join(", ");
export const known = (tune: FinderTune) => tune.level === "learned" || tune.level === "mastered";
export const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const clock = (ms: number) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };

/** Where a heard tune stands for this person: "In Madrid Session, Can play along", "Want to learn", "In your library". */
export function standing(tune: FinderTune) {
  const parts: string[] = [];
  if (tune.inBooks.length) parts.push(`In ${tune.inBooks.length === 1 ? tune.inBooks[0].name : `${tune.inBooks.length} of your tunebooks`}`);
  if (tune.level !== "unlearned") parts.push(ABILITY_LABELS[tune.level]);
  else if (tune.savedId && !tune.inBooks.length) parts.push("In your library");
  return parts.join(", ");
}

/** One tap to keep a tune for later: saved and marked Want to learn. Nothing for a tune already known. */
export function LearnLater({ tune, context }: { tune: FinderTune; context: FinderContext }) {
  const { listener, signedIn, next } = context;
  if (known(tune)) return null;
  if (tune.level === "wanted") return <span className="finder-kept"><Check size={14} /> On your list</span>;
  if (!signedIn) return <Link className="button button-outline button-sm" onClick={() => trackEvent("guest_sign_in_clicked", { source: "finder_save" })} href={`/sign-up?next=${encodeURIComponent(next)}`}><Bookmark size={14} /> Learn later</Link>;
  return <Button size="sm" variant="outline" disabled={listener.saving === tune.tuneId} onClick={() => void listener.learnLater(tune)}><Bookmark size={14} /> {listener.saving === tune.tuneId ? "Saving" : "Learn later"}</Button>;
}

/** The answer leads to music: the full score first, then keeping it for later, then its page on The Session. */
export function FinderActions({ tune, context, primary = false }: { tune: FinderTune; context: FinderContext; primary?: boolean }) {
  return <div className="finder-actions">
    <Button size="sm" variant={primary ? "default" : "ghost"} onClick={() => context.onScore(tune)}><Music size={14} /> {primary ? "Open full score" : "Score"}</Button>
    <LearnLater tune={tune} context={context} />
    {primary && <a className="finder-source" href={`https://thesession.org/tunes/${tune.tuneId}`} target="_blank" rel="noreferrer">View on The Session</a>}
  </div>;
}

export function FinderRow({ tune, detail, context, phrase = false }: { tune: FinderTune; detail: string; context: FinderContext; phrase?: boolean }) {
  return <li className="finder-row">
    <div className="finder-row-head"><div><span className="finder-row-title">{displayTitle(tune.title)}</span><span className="finder-meta">{[detail, standing(tune)].filter(Boolean).join(", ")}</span></div><FinderActions tune={tune} context={context} /></div>
    {phrase && <OpeningPhrase tune={tune} className="is-small" />}
  </li>;
}

/** A named tune: whether it is sure, the title as people say it, where it stands for you, and how it starts. */
export function FinderAnswer({ tune, sure, context }: { tune: FinderTune; sure: boolean; context: FinderContext }) {
  return <div key={tune.tuneId} className={`finder-answer ${sure ? "is-match" : ""}`}>
    {!sure && <p className="finder-state">Possible match</p>}
    <h2>{displayTitle(tune.title)}</h2><p className="finder-meta">{meta(tune)}</p>
    {standing(tune) && <p className={`finder-standing ${known(tune) ? "is-known" : ""}`}>{standing(tune)}</p>}
    <OpeningPhrase tune={tune} />
    <p className="finder-phrase-note">{tune.savedId ? "Opening bars of your setting" : "Opening bars of The Session's setting, not a transcription"}</p>
    <FinderActions tune={tune} context={context} primary />
  </div>;
}

/** Other candidates, with how they start: shown at once when the finder is unsure, behind "Not it?" when it is sure. */
export function FinderAlternatives({ sure, context }: { sure: boolean; context: FinderContext }) {
  const { listener } = context;
  const [open, setOpen] = useState(false);
  if (!listener.alternatives.length) return null;
  return <>
    {sure && <button type="button" className="finder-link" aria-expanded={open} onClick={() => setOpen(!open)}>Not it?</button>}
    {(open || !sure) && <div className="finder-others">
      <p className="finder-others-title">{sure ? "Other close matches" : "Or it could be"}</p>
      <ul>{listener.alternatives.slice(0, sure ? 4 : 2).map((tune) => <FinderRow key={tune.tuneId} tune={tune} detail={meta(tune)} context={context} phrase />)}</ul>
      {listener.phase === "listening" && <button type="button" className="finder-link" onClick={() => { listener.restart(); setOpen(false); }}>Listen again from here</button>}
    </div>}
  </>;
}

/** For a tune someone names out loud; results show exactly like a heard tune. */
export function FinderSearch({ context }: { context: FinderContext }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FinderTune[] | null>(null);
  const timer = useRef(0);
  function search(text: string) {
    setQuery(text);
    window.clearTimeout(timer.current);
    if (text.trim().length < 2) { setFound(null); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/finder?q=${encodeURIComponent(text.trim())}`, { cache: "no-store" });
        if (response.ok) setFound((await response.json()).tunes as FinderTune[]);
      } catch { setFound([]); }
    }, 250);
  }
  return <section className="finder-search" aria-label="Search by name">
    <label className="finder-search-field"><Search size={16} aria-hidden="true" /><span className="sr-only">Search for a tune by name</span><input type="search" value={query} onChange={(event) => search(event.target.value)} placeholder="Know the name? Search for it" enterKeyHint="search" /></label>
    {found && (found.length ? <ul>{found.map((tune) => <FinderRow key={tune.tuneId} tune={tune} detail={meta(tune)} context={context} />)}</ul> : <p className="finder-meta">No tune by that name on The Session.</p>)}
  </section>;
}

/** Tonight's tunes, with a recap of how many the person already knows, and a way to keep them as a tunebook. */
export function FinderHeard({ context }: { context: FinderContext }) {
  const { listener, signedIn } = context;
  const router = useRouter();
  const [making, setMaking] = useState<"idle" | "busy" | "error">("idle");
  if (!listener.heard.length) return null;
  const tunes = [...new Map(listener.heard.map((h) => [h.tune.tuneId, h.tune])).values()];
  const wanted = tunes.filter((t) => t.level === "wanted").length;
  const recap = tunes.length > 1 ? `You heard ${tunes.length} tunes. You can play along with ${tunes.filter(known).length}${wanted ? `, and ${wanted} ${wanted === 1 ? "is" : "are"} on your list to learn` : ""}.` : null;
  return <section className="finder-heard"><h3>Heard</h3>{recap && <p className="finder-recap">{recap}</p>}
    <ul>{listener.heard.map((h) => <FinderRow key={`${h.tune.tuneId}-${h.at}`} tune={h.tune} detail={`${meta(h.tune)}, ${time(h.at)}`} context={context} />)}</ul>
    {signedIn && <div className="finder-heard-actions"><Button variant="outline" size="sm" disabled={making === "busy"} onClick={async () => {
      setMaking("busy");
      try { const bookId = await listener.makeBook("Tonight's tunes"); listener.clearHeard(); router.push(`/books/${bookId}`); } catch { setMaking("error"); }
    }}><BookPlus size={15} /> {making === "busy" ? "Making the tunebook" : "Make a tunebook of these"}</Button>
    <button type="button" className="finder-link" onClick={listener.clearHeard}>Clear</button>{making === "error" && <p role="alert" className="form-error">Could not make the tunebook. Try again.</p>}</div>}
  </section>;
}

/** A heard or searched tune's whole score, full screen. */
export function FinderScore({ tune, context, onClose }: { tune: FinderTune; context: FinderContext; onClose: () => void }) {
  return <ScoreSheet tune={tune} title={displayTitle(tune.title)} meta={[meta(tune), standing(tune)].filter(Boolean).join(", ")} note={tune.savedId ? "Your setting of this tune." : "The Session's first setting of this tune. Other settings are on The Session."}
    actions={<><LearnLater tune={tune} context={context} />{tune.savedId && <Link className="button button-ghost button-sm" href={`/tunes/${tune.savedId}`}>Open in your library</Link>}</>} onClose={onClose} />;
}
