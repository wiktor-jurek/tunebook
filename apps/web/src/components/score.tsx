"use client";

import { trackEvent } from "@/lib/analytics";
import { useRef, useState, useSyncExternalStore } from "react";
import { ExternalLink, FileText, MoreHorizontal, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TuneWithPractice } from "@/lib/tune-practice";
import { PracticeBar, TuneAbility } from "@/components/tune-ability";
import { TuneIcon } from "@/components/tune-icon";
import { abcForScore, abcForTune, keyName } from "@/lib/notation";
import { DEFAULT_SOUND } from "@/lib/sounds";
import type { Playalong } from "@/lib/playalongs";
import { displayTitle } from "@/lib/titles";
import { PlayerIsland, SoundMenu, SpeedControl, useTunePlayer } from "@/components/tune-player";

export { pauseTune } from "@/components/tune-player";

type Tune = TuneWithPractice;
// A phone-width window: the tune page's player floats as an island over the score instead of sitting under it.
const NARROW = "(max-width: 760px)";
const watchNarrow = (onChange: () => void) => { const query = window.matchMedia(NARROW); query.addEventListener("change", onChange); return () => query.removeEventListener("change", onChange); };

/** `hotkeys`: Space plays and pauses, for a page with this one score (on a narrow screen, its player floats as an island). */
export function Score({ tune, defaultSound = DEFAULT_SOUND, showTitle = true, playbackId, practiceEditable = true, showPractice = true, playalongs = [], hotkeys = false }: { tune: Tune; defaultSound?: number; showTitle?: boolean; playbackId?: string; practiceEditable?: boolean; showPractice?: boolean; playalongs?: Playalong[]; hotkeys?: boolean }) {
  const [showAbc, setShowAbc] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  const player = useTunePlayer({ paperRef, tune, notation: abcForScore(tune), scoreId: playbackId ?? tune.id, defaultSound, playalongs, hotkeys, renderOptions: { staffwidth: 760, paddingtop: 0, paddingbottom: 0 } });
  const { ready, playing, loading, error, counting, speed, track, progress, toggle, seek } = player;
  const narrow = useSyncExternalStore(watchNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const island = hotkeys && narrow;
  const meta = [tune.kind, keyName(tune.mode), tune.meter, tune.composer].filter(Boolean).join(", ");
  const trackKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
  return <article className="score-sheet"><div className="score-header">{showTitle && <TuneIcon tune={tune} size="page" />}<div className="score-title">{showTitle && <h2>{displayTitle(tune.title)}</h2>}<p className="score-meta">{meta}</p>{showTitle && showPractice && !practiceEditable && <TuneAbility tune={tune} editable={false} />}</div>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`More about ${displayTitle(tune.title)}`} title="More"><MoreHorizontal size={17} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" collisionPadding={12}>
      {tune.contributor && <DropdownMenuLabel>Setting by {tune.contributor}</DropdownMenuLabel>}
      <DropdownMenuItem onSelect={() => { if (!showAbc) trackEvent("notation_opened", {}); setShowAbc(!showAbc); }}><FileText size={15} /><span>{showAbc ? "Hide ABC notation" : "Show ABC notation"}</span></DropdownMenuItem>
      <DropdownMenuItem asChild><a href={tune.sourceUrl} target="_blank" rel="noreferrer" onClick={() => trackEvent("tune_source_opened", {})}><ExternalLink size={15} /><span>Open on The Session</span></a></DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu></div>
    <div className="notation-frame"><div ref={paperRef} className="notation" aria-label={`Sheet music for ${displayTitle(tune.title)}`} />{!ready && <p>Rendering score</p>}</div>
    <div className="player" data-island={island ? "" : undefined} aria-label={`Player for ${displayTitle(tune.title)}`}>
      <div className="player-row">
        <Button size="icon" className="player-play" data-loading={counting ? "" : undefined} aria-label={playing || counting ? "Pause" : "Play"} disabled={!ready || loading} onClick={toggle}>{playing || counting ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</Button>
        <input className="player-seek" type="range" min="0" max="100" value={progress} aria-label="Playback position" onPointerUp={() => trackEvent("playback_seeked", {})} onKeyUp={(event) => { if (trackKeys.includes(event.key)) trackEvent("playback_seeked", {}); }} onChange={(event) => void seek(Number(event.target.value))} />
        <SoundMenu player={player} />
      </div>
      <SpeedControl player={player} />
      {showPractice && practiceEditable && <PracticeBar tune={tune} speed={speed} />}
      {counting && <p className="player-status">Counting in</p>}{loading && <p className="player-status">{track ? "Loading recording" : "Loading instrument"}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    </div>
    {showAbc && <pre className="abc-text">{abcForTune(tune)}</pre>}
    {island && <PlayerIsland player={player} mode="practice" />}
  </article>;
}
