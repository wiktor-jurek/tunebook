"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import abcjs from "abcjs";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Music2, Pause, Play } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SOUND_OPTIONS } from "@/lib/sounds";
import type { Playalong } from "@/lib/playalongs";
import type { PlayalongTiming } from "@/db/schema";
import { scorePosition, TIMING_UNIT } from "@/lib/playalong-timing";

// Playing a score: the synthesised notes through an instrument, or a play-along recording that follows the score, with the
// note being played lit up. The practice page's full player and the session's compact one share it.

type PlayerTune = { title: string; meter: string | null };
type Visual = ReturnType<typeof abcjs.renderAbc>[number];
// audio is set while a play-along recording is the sound; otherwise the score is synthesised into buffer.
// A recording with timing follows the score through the score's note events, kept in follow.
type Player = { buffer?: AudioBuffer; key?: string; source?: AudioBufferSourceNode; gain?: GainNode; audio?: HTMLAudioElement; timing?: PlayalongTiming | null; follow?: abcjs.NoteTimingEvent[]; followAt?: number; startedAt: number; offset: number; timer?: abcjs.TimingCallbacks; raf?: number; playing: boolean; token: number };
let sharedContext: AudioContext | null = null;
const instruments = SOUND_OPTIONS;
// The lead instrument of a play-along, for its button.
const LEAD_EMOJI: [RegExp, string][] = [[/fiddle|violin/i, "🎻"], [/whistle|flute/i, "🪈"], [/accordion|concertina/i, "🪗"], [/banjo/i, "🪕"], [/piano/i, "🎹"], [/guitar|bouzouki/i, "🎸"]];
const leadEmoji = (label: string) => LEAD_EMOJI.find(([pattern]) => pattern.test(label))?.[1] ?? "🎶";
// The device's own volume is the volume control; this leaves headroom for chords in the synth.
const VOLUME = 0.75;
// The score plays at this many crotchets a minute at 100% (Q:1/4=100 in abcForTune).
const SCORE_QPM = 100;
const SPEED_STEPS = ["75", "85", "100"] as const;

// The beat a player counts in a tune's meter: dotted crotchets in jigs and slip jigs (6/8, 9/8, 12/8), otherwise the
// meter's own note. How many to a bar, and how many crotchets each lasts.
function beatOf(meter: string | null) {
  const [count, unit] = (meter ?? "4/4").split("/").map(Number);
  if (!count || !unit) return { perBar: 4, crotchets: 1 };
  const compound = unit === 8 && count > 3 && count % 3 === 0;
  return compound ? { perBar: count / 3, crotchets: 1.5 } : { perBar: count, crotchets: 4 / unit };
}

// The count-in setting, kept on this device and shared by every score on the page.
const COUNT_IN_KEY = "tunebook-count-in";
const countInListeners = new Set<() => void>();
const countInStore = {
  subscribe(listener: () => void) { countInListeners.add(listener); return () => { countInListeners.delete(listener); }; },
  get: () => localStorage.getItem(COUNT_IN_KEY) === "1",
  set(on: boolean) { localStorage.setItem(COUNT_IN_KEY, on ? "1" : "0"); countInListeners.forEach((listener) => listener()); },
};

// One bar of clicks, the first higher, before the music starts. Resolves when the bar is over.
async function playCountIn(context: AudioContext, beats: number, beatSeconds: number) {
  const start = context.currentTime + 0.05;
  for (let beat = 0; beat < beats; beat++) {
    const at = start + beat * beatSeconds;
    const tone = context.createOscillator(), gain = context.createGain();
    tone.frequency.value = beat === 0 ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    tone.connect(gain).connect(context.destination);
    tone.start(at); tone.stop(at + 0.08);
  }
  await new Promise((resolve) => setTimeout(resolve, (0.05 + beats * beatSeconds) * 1000));
}


export function pauseTune(tuneId: string) {
  window.dispatchEvent(new CustomEvent("tunebook:pause", { detail: tuneId }));
}


/**
 * Renders `notation` into `paperRef` (the caller's element) (with `renderOptions`) and plays it. `scoreId` keys the playback, so starting one
 * score pauses any other. `hotkeys`: Space plays and pauses, for a page with this one score.
 */
export function useTunePlayer({ paperRef, tune, notation, scoreId, defaultSound, playalongs = [], hotkeys = false, renderOptions = {} }: {
  paperRef: React.RefObject<HTMLDivElement | null>; tune: PlayerTune; notation: string; scoreId: string; defaultSound: number; playalongs?: Playalong[]; hotkeys?: boolean; renderOptions?: abcjs.AbcVisualParams;
}) {
  const renderKey = JSON.stringify(renderOptions);
  const visualRef = useRef<Visual | null>(null);
  const playerRef = useRef<Player>({ startedAt: 0, offset: 0, playing: false, token: 0 });
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [soundOverride, setInstrument] = useState<number | null>(null);
  const instrument = soundOverride ?? defaultSound;
  const [trackId, setTrackId] = useState<string | null>(null);
  const track = playalongs.find((entry) => entry.id === trackId) ?? null;
  const [speed, setSpeed] = useState(100);
  const [progress, setProgress] = useState(0);
  const [counting, setCounting] = useState(false);
  const countIn = useSyncExternalStore(countInStore.subscribe, countInStore.get, () => false);
  const beat = beatOf(tune.meter);
  // The tempo you'd set a metronome to: the sound's crotchets a minute at this speed, in the meter's beat.
  const bpm = Math.round((track?.bpm ?? SCORE_QPM) * speed / 100 / beat.crotchets);
  const [activeElements, setActiveElements] = useState<HTMLElement[]>([]);

  useEffect(() => {
    if (!paperRef.current) return;
    const player = playerRef.current;
    const result = abcjs.renderAbc(paperRef.current, notation, { responsive: "resize", add_classes: true, selectTypes: false, ...renderOptions });
    visualRef.current = result[0] || null;
    player.follow = undefined;
    setReady(Boolean(result[0]));
    return () => {
      player.token++;
      player.source?.stop(); player.timer?.stop(); player.audio?.pause();
      if (player.raf) cancelAnimationFrame(player.raf);
      player.playing = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the options are compared by value, through renderKey
  }, [notation, scoreId, renderKey]);

  useEffect(() => {
    for (const element of activeElements) element.classList.add("playing-note");
    return () => { for (const element of activeElements) element.classList.remove("playing-note"); };
  }, [activeElements]);

  useEffect(() => {
    function cancelPlayback() {
      playerRef.current.token++;
      pause();
      setLoading(false);
    }
    function otherPlayer(event: Event) {
      if ((event as CustomEvent<string>).detail !== scoreId) cancelPlayback();
    }
    function pauseRequested(event: Event) {
      if ((event as CustomEvent<string>).detail === scoreId) cancelPlayback();
    }
    window.addEventListener("tunebook:play", otherPlayer);
    window.addEventListener("tunebook:pause", pauseRequested);
    return () => { window.removeEventListener("tunebook:play", otherPlayer); window.removeEventListener("tunebook:pause", pauseRequested); };
  }, [scoreId]);

  function pause() {
    const p = playerRef.current;
    if (!p.playing) return;
    if (p.audio) p.audio.pause();
    else {
      p.offset = Math.min(p.buffer?.duration || 0, sharedContext!.currentTime - p.startedAt);
      p.source?.stop(); p.source = undefined; p.timer?.pause();
    }
    if (p.raf) cancelAnimationFrame(p.raf);
    p.playing = false; setPlaying(false);
  }
  function finished() {
    const p = playerRef.current;
    p.playing = false; p.source = undefined; p.offset = 0; p.timer?.stop();
    setPlaying(false); setProgress(0); setActiveElements([]);
    if (p.raf) cancelAnimationFrame(p.raf);
  }
  // Share of the way through the current sound, from 0 to 1.
  function position() {
    const p = playerRef.current;
    if (p.audio) return p.audio.duration ? p.audio.currentTime / p.audio.duration : 0;
    return p.buffer ? (p.playing && sharedContext ? sharedContext.currentTime - p.startedAt : p.offset) / p.buffer.duration : 0;
  }
  // Highlights the note a play-along recording has reached, from its timing.
  function followRecording() {
    const p = playerRef.current, visual = visualRef.current;
    if (!p.audio || !p.timing || !visual) return;
    if (!p.follow) {
      visual.setUpAudio({}); // gives the note events their pitches
      p.follow = new abcjs.TimingCallbacks(visual, {}).noteTimings.filter((event) => event.type === "event");
    }
    const position = scorePosition(p.timing, p.audio.currentTime * 1000);
    let at = -1;
    if (position !== null && p.follow.length) {
      const ms = position / TIMING_UNIT / visual.getBarLength() * p.follow[0].millisecondsPerMeasure;
      while (at + 1 < p.follow.length && p.follow[at + 1].milliseconds <= ms) at++;
    }
    if (at === p.followAt) return;
    p.followAt = at;
    const event = p.follow[at];
    setActiveElements(event?.elements?.flat() as HTMLElement[] || []);
  }
  function tick() {
    const p = playerRef.current;
    if (!p.playing || (!p.audio && (!p.buffer || !sharedContext))) return;
    setProgress(Math.min(100, Math.round(position() * 100)));
    followRecording();
    p.raf = requestAnimationFrame(tick);
  }
  async function startRecording(recording: Playalong, nextSpeed: number, offsetRatio?: number, userStarted = true) {
    const p = playerRef.current;
    const token = ++p.token;
    setLoading(true); setError("");
    try {
      if (!p.audio || p.key !== recording.id) {
        p.audio?.pause();
        const audio = new Audio(recording.url);
        audio.preload = "auto";
        audio.onended = () => { if (p.audio === audio && p.playing) { trackEvent("playback_completed", {}); audio.currentTime = 0; finished(); } };
        p.audio = audio; p.key = recording.id;
      }
      const audio = p.audio;
      // Slowed-down practice keeps the recording in tune.
      audio.preservesPitch = true;
      audio.playbackRate = nextSpeed / 100;
      audio.volume = VOLUME;
      if (offsetRatio !== undefined) audio.currentTime = offsetRatio * recording.durationMs / 1000;
      await audio.play();
      if (token !== p.token) { audio.pause(); return; }
      p.timing = recording.timing; p.followAt = undefined;
      setActiveElements([]);
      p.playing = true; setPlaying(true); tick();
      if (userStarted) trackEvent("playalong_started", { tempo: nextSpeed, tune: tune.title, label: recording.label });
      window.dispatchEvent(new CustomEvent("tunebook:play", { detail: scoreId }));
    } catch (cause) { trackEvent("playback_failed", {}); setError(cause instanceof Error ? cause.message : "Audio failed"); }
    finally { if (token === p.token) setLoading(false); }
  }
  async function start(nextInstrument = instrument, nextSpeed = speed, offsetRatio?: number, userStarted = true, recording = track) {
    if (recording) return startRecording(recording, nextSpeed, offsetRatio, userStarted);
    const visual = visualRef.current;
    if (!visual || !abcjs.synth.supportsAudio()) { trackEvent("playback_failed", {}); setError("Audio is unavailable in this browser"); return; }
    const p = playerRef.current;
    const token = ++p.token;
    setLoading(true); setError("");
    try {
      sharedContext ||= new AudioContext();
      await sharedContext.resume();
      const key = `${nextInstrument}:${nextSpeed}`;
      if (p.key !== key || !p.buffer) {
        const synth = new abcjs.synth.CreateSynth();
        const result = await synth.init({ visualObj: visual, audioContext: sharedContext, millisecondsPerMeasure: visual.millisecondsPerMeasure() * 100 / nextSpeed, options: { program: nextInstrument, soundFontUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/" } });
        if (result.error.length) throw new Error("Some instrument notes could not be loaded");
        await synth.prime();
        if (token !== p.token) return;
        p.buffer = synth.getAudioBuffer(); p.key = key;
        if (!p.buffer) throw new Error("Could not prepare audio");
        p.timer?.stop();
        p.timer = new abcjs.TimingCallbacks(visual, { qpm: visual.getBpm() * nextSpeed / 100, eventCallback: (event) => {
                setActiveElements(event?.elements?.flat() as HTMLElement[] || []);
          return undefined;
        } });
      }
      if (token !== p.token || !p.buffer) return;
      const source = sharedContext.createBufferSource();
      const gain = sharedContext.createGain();
      source.buffer = p.buffer; gain.gain.value = VOLUME;
      source.connect(gain).connect(sharedContext.destination);
      p.offset = offsetRatio !== undefined ? Math.min(p.buffer.duration - 0.01, Math.max(0, offsetRatio * p.buffer.duration)) : p.offset;
      p.source = source; p.gain = gain;
      p.startedAt = sharedContext.currentTime - p.offset;
      source.onended = () => { if (p.source === source && p.playing) { trackEvent("playback_completed", {}); finished(); } };
      source.start(0, p.offset);
      p.timer?.start(p.offset, "seconds");
      p.playing = true; setPlaying(true); tick();
      if (userStarted) trackEvent("playback_started", { instrument: nextInstrument, tempo: nextSpeed, tune: tune.title });
      window.dispatchEvent(new CustomEvent("tunebook:play", { detail: scoreId }));
    } catch (cause) { trackEvent("playback_failed", {}); setError(cause instanceof Error ? cause.message : "Audio failed"); }
    finally { if (token === p.token) setLoading(false); }
  }
  // Sound is either a General MIDI program for the synthesised score or "track:<id>" for a play-along.
  async function changeSound(value: string) {
    const recording = playalongs.find((entry) => `track:${entry.id}` === value) ?? null;
    const program = recording ? instrument : Number(value);
    if (recording) trackEvent("playalong_selected", { label: recording.label });
    else trackEvent("playback_sound_changed", { instrument: program });
    const p = playerRef.current;
    const switching = Boolean(recording) !== Boolean(p.audio);
    const ratio = switching ? 0 : position();
    const wasPlaying = p.playing;
    pause();
    if (!recording && p.audio) { p.audio = undefined; p.key = undefined; }
    if (switching) { p.offset = 0; p.timer?.reset(); setProgress(0); }
    setTrackId(recording?.id ?? null); setInstrument(program);
    if (wasPlaying) await start(program, speed, ratio, false, recording);
  }
  async function changeSpeed(value: number) {
    const p = playerRef.current;
    if (p.audio) { setSpeed(value); p.audio.playbackRate = value / 100; return; }
    const ratio = position();
    const wasPlaying = p.playing;
    pause(); setSpeed(value);
    if (wasPlaying) await start(instrument, value, ratio, false);
  }
  async function seek(value: number) {
    const p = playerRef.current;
    if (p.audio) { if (p.audio.duration) p.audio.currentTime = value / 100 * p.audio.duration; setProgress(value); followRecording(); return; }
    const wasPlaying = p.playing;
    pause();
    p.offset = p.buffer ? value / 100 * p.buffer.duration : 0;
    p.timer?.setProgress(value / 100);
    setProgress(value);
    if (wasPlaying) await start(instrument, speed, value / 100, false);
  }
  // Play, after a bar of clicks when count-in is on and the sound is the score (a recording has its own lead-in).
  async function play() {
    const p = playerRef.current;
    if (countIn && !track) {
      const token = ++p.token;
      setCounting(true);
      sharedContext ||= new AudioContext();
      await sharedContext.resume();
      await playCountIn(sharedContext, beat.perBar, 60 / (SCORE_QPM * speed / 100) * beat.crotchets);
      setCounting(false);
      if (token !== p.token) return;
    }
    await start();
  }
  function toggle() {
    const p = playerRef.current;
    if (counting) { p.token++; setCounting(false); return; }
    if (playing) { trackEvent("playback_paused", {}); pause(); } else void play();
  }
  const toggleRef = useRef(toggle);
  useEffect(() => { toggleRef.current = toggle; });
  useEffect(() => {
    if (!hotkeys) return;
    function onKey(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable], [role=menu], [role=dialog]")) return;
      event.preventDefault();
      toggleRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys]);
  const soundName = track ? track.label : `Notes, ${instruments.find((entry) => entry.program === instrument)?.label ?? "score"}`;
  return { ready, playing, loading, error, counting, countIn, speed, bpm, track, instrument, progress, soundName, playalongs, toggle, seek, changeSpeed, changeSound };
}
export type TunePlayer = ReturnType<typeof useTunePlayer>;

const trackKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

/** One menu for the sound: the score through an instrument, or a play-along recording. `compact` shows only the icon. */
export function SoundMenu({ player, compact = false }: { player: TunePlayer; compact?: boolean }) {
  const { track, instrument, soundName, playalongs, changeSound } = player;
  return <>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="player-source" aria-label={`Sound: ${soundName}. Change sound`}>
          {track ? <span aria-hidden="true">{leadEmoji(track.label)}</span> : <Music2 size={14} aria-hidden="true" />}{!compact && <span className="player-source-name">{soundName}</span>}<ChevronDown size={14} aria-hidden="true" />
        </Button></DropdownMenuTrigger><DropdownMenuContent align="end" collisionPadding={12}>
          <DropdownMenuLabel>Notes</DropdownMenuLabel>
          {instruments.map((entry) => <DropdownMenuCheckboxItem key={entry.program} checked={!track && instrument === entry.program} onCheckedChange={() => void changeSound(String(entry.program))}>{entry.label}</DropdownMenuCheckboxItem>)}
          {playalongs.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Play-along recordings</DropdownMenuLabel>
            {playalongs.map((entry) => <DropdownMenuCheckboxItem key={entry.id} checked={track?.id === entry.id} onCheckedChange={() => void changeSound(`track:${entry.id}`)}>
              <span aria-hidden="true">{leadEmoji(entry.label)}</span> {entry.label}{entry.otherSetting && <span className="playalong-other">other setting</span>}
            </DropdownMenuCheckboxItem>)}</>}
        </DropdownMenuContent></DropdownMenu>
  </>;
}

/** Speed: steps, a slider (unless `compact`), the speed and its tempo, and count-in for the score's notes. */
export function SpeedControl({ player, compact = false }: { player: TunePlayer; compact?: boolean }) {
  const { speed, bpm, track, countIn, changeSpeed } = player;
  return <div className={compact ? "player-speed is-compact" : "player-speed"}>
        {!compact && <span className="player-speed-label">Speed</span>}
        <SegmentedControl label="Speed" value={String(speed)} onChange={(value) => { trackEvent("playback_tempo_changed", { tempo: Number(value) }); void changeSpeed(Number(value)); }} options={SPEED_STEPS.map((step) => ({ value: step, label: `${step}%` }))} />
        {!compact && <input className="player-speed-slider" type="range" min="50" max="150" step="5" value={speed} onChange={(event) => void changeSpeed(Number(event.target.value))} aria-label="Speed" aria-valuetext={`${speed}%, ${bpm} beats a minute`} onPointerUp={(event) => trackEvent("playback_tempo_changed", { tempo: Number(event.currentTarget.value) })} onKeyUp={(event) => { if (trackKeys.includes(event.key)) trackEvent("playback_tempo_changed", { tempo: Number(event.currentTarget.value) }); }} />}
        {compact ? <output className="player-speed-value"><span>{bpm} BPM</span></output> : <output className="player-speed-value">{speed}%<span>{bpm} BPM</span></output>}
        {!track && !compact && <Chip className="player-count-in" pressed={countIn} onClick={() => { trackEvent("count_in_toggled", { on: !countIn }); countInStore.set(!countIn); }}>Count-in</Chip>}
      </div>;
}

// Whether the player island is out, per mode and kept on this device: session mode starts with it put away (the phone is
// for reading in the pub), practice mode with it out.
type IslandMode = "session" | "practice";
const islandListeners = new Set<() => void>();
const islandKey = (mode: IslandMode) => `tunebook-player-island-${mode}`;
const islandStore = {
  subscribe(listener: () => void) { islandListeners.add(listener); return () => { islandListeners.delete(listener); }; },
  get: (mode: IslandMode) => { const saved = localStorage.getItem(islandKey(mode)); return saved ? saved === "open" : mode === "practice"; },
  set(mode: IslandMode, open: boolean) { localStorage.setItem(islandKey(mode), open ? "open" : "closed"); islandListeners.forEach((listener) => listener()); },
};
/** How far down a swipe has to carry the island, in px, or how fast (px per second), to put it away. */
const DISMISS_DISTANCE = 40, DISMISS_SPEED = 400;

/**
 * The player as a floating island over a phone's score: play, where it is, speed and sound, out of the music's way.
 * Swiped down it goes, leaving a small round button in the corner that brings it back.
 */
export function PlayerIsland({ player, mode }: { player: TunePlayer; mode: IslandMode }) {
  const open = useSyncExternalStore(islandStore.subscribe, () => islandStore.get(mode), () => mode === "practice");
  const { ready, playing, loading, counting, progress, toggle, seek } = player;
  const busy = playing || counting;
  return <AnimatePresence initial={false} mode="popLayout">
    {open ? <motion.div key="island" className="player-island" role="region" aria-label="Player"
      initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 36 }}
      drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.1, bottom: 0.9 }}
      onDragEnd={(_, info) => { if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_SPEED) { trackEvent("player_island_toggled", { open: false }); islandStore.set(mode, false); } }}>
      <span className="player-island-grip" aria-hidden="true" />
      <input className="player-island-seek" type="range" min="0" max="100" value={progress} aria-label="Playback position" onChange={(event) => void seek(Number(event.target.value))} onPointerDownCapture={(event) => event.stopPropagation()} />
      <div className="player-island-row">
        <Button size="icon" className="player-play" data-loading={counting || loading ? "" : undefined} aria-label={busy ? "Pause" : "Play"} disabled={!ready || loading} onClick={toggle}>{busy ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</Button>
        <SpeedControl player={player} compact />
        <SoundMenu player={player} compact />
      </div>
    </motion.div>
    : <motion.div key="handle" className="player-island-handle" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
      <Button size="icon" variant="outline" aria-label={playing ? "Playing. Show the player" : "Show the player"} onClick={() => { trackEvent("player_island_toggled", { open: true }); islandStore.set(mode, true); }}>
        {playing ? <span className="player-island-live" aria-hidden="true"><i /><i /><i /></span> : <Play size={16} fill="currentColor" />}
      </Button>
    </motion.div>}
  </AnimatePresence>;
}
