"use client";

import { trackEvent } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import abcjs from "abcjs";
import { Music2, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TuneWithPractice } from "@/lib/tune-practice";
import { PracticeSpeed, TuneAbility } from "@/components/tune-ability";
import { TuneIcon } from "@/components/tune-icon";
import { abcForScore, abcForTune, noteNames } from "@/lib/notation";
import { DEFAULT_SOUND, SOUND_OPTIONS } from "@/lib/sounds";
import type { Playalong } from "@/lib/playalongs";
import type { PlayalongTiming } from "@/db/schema";

type Tune = TuneWithPractice;
type Visual = ReturnType<typeof abcjs.renderAbc>[number];
// audio is set while a play-along recording is the sound; otherwise the score is synthesised into buffer.
// A recording with timing follows the score through the score's note events, kept in follow.
type Player = { buffer?: AudioBuffer; key?: string; source?: AudioBufferSourceNode; gain?: GainNode; audio?: HTMLAudioElement; timing?: PlayalongTiming | null; follow?: abcjs.NoteTimingEvent[]; followAt?: number; startedAt: number; offset: number; timer?: abcjs.TimingCallbacks; raf?: number; playing: boolean; token: number };
let sharedContext: AudioContext | null = null;
const instruments = SOUND_OPTIONS;
// The lead instrument of a play-along, for its button.
const LEAD_EMOJI: [RegExp, string][] = [[/fiddle|violin/i, "🎻"], [/whistle|flute/i, "🪈"], [/accordion|concertina/i, "🪗"], [/banjo/i, "🪕"], [/piano/i, "🎹"], [/guitar|bouzouki/i, "🎸"]];
const leadEmoji = (label: string) => LEAD_EMOJI.find(([pattern]) => pattern.test(label))?.[1] ?? "🎶";
// Timing positions are in 1/48 of a whole note, as ml/yue/timing.py writes them.
const TIMING_UNIT = 48;

// Score position of a play-along recording at ms into it, or null during its lead-in and after the tune ends.
function scorePosition({ anchors, loop }: PlayalongTiming, ms: number) {
  if (anchors.length < 2 || ms < anchors[0][0] || ms > anchors[anchors.length - 1][0]) return null;
  let i = 1;
  while (anchors[i][0] < ms) i++;
  const [fromMs, from] = anchors[i - 1], [toMs, to] = anchors[i];
  const position = from + (to - from) * (ms - fromMs) / (toMs - fromMs);
  if (position < 0) return null;
  return loop ? position % loop : position;
}

export function pauseTune(tuneId: string) {
  window.dispatchEvent(new CustomEvent("tunebook:pause", { detail: tuneId }));
}

export function Score({ tune, defaultSound = DEFAULT_SOUND, showTitle = true, playbackId, practiceEditable = true, showPractice = true, playalongs = [] }: { tune: Tune; defaultSound?: number; showTitle?: boolean; playbackId?: string; practiceEditable?: boolean; showPractice?: boolean; playalongs?: Playalong[] }) {
  const paperRef = useRef<HTMLDivElement>(null);
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
  const [volume, setVolume] = useState(75);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState("-");
  const [activeElements, setActiveElements] = useState<HTMLElement[]>([]);
  const scoreId = playbackId ?? tune.id;
  const notation = abcForScore(tune);

  useEffect(() => {
    if (!paperRef.current) return;
    const player = playerRef.current;
    const result = abcjs.renderAbc(paperRef.current, notation, { responsive: "resize", add_classes: true, staffwidth: 760, paddingtop: 0, paddingbottom: 0 });
    visualRef.current = result[0] || null;
    player.follow = undefined;
    setReady(Boolean(result[0]));
    return () => {
      player.token++;
      player.source?.stop(); player.timer?.stop(); player.audio?.pause();
      if (player.raf) cancelAnimationFrame(player.raf);
      player.playing = false;
    };
  }, [notation, scoreId]);

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
  function reset() {
    pause();
    const p = playerRef.current;
    if (p.audio) p.audio.currentTime = 0;
    p.followAt = undefined; p.offset = 0; p.timer?.reset(); setProgress(0); setNote("-"); setActiveElements([]);
  }
  function finished() {
    const p = playerRef.current;
    p.playing = false; p.source = undefined; p.offset = 0; p.timer?.stop();
    setPlaying(false); setProgress(0); setNote("-"); setActiveElements([]);
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
      visual.setUpAudio({}); // gives the note events their pitches, for the note display
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
    setNote(noteNames(event?.midiPitches));
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
      audio.volume = volume / 100;
      if (offsetRatio !== undefined) audio.currentTime = offsetRatio * recording.durationMs / 1000;
      await audio.play();
      if (token !== p.token) { audio.pause(); return; }
      p.timing = recording.timing; p.followAt = undefined;
      setNote("-"); setActiveElements([]);
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
          setNote(noteNames(event?.midiPitches));
          setActiveElements(event?.elements?.flat() as HTMLElement[] || []);
          return undefined;
        } });
      }
      if (token !== p.token || !p.buffer) return;
      const source = sharedContext.createBufferSource();
      const gain = sharedContext.createGain();
      source.buffer = p.buffer; gain.gain.value = volume / 100;
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
  return <article className="score-sheet"><div className="score-header">{showTitle && <TuneIcon tune={tune} size="page" />}<div className="score-title">{showTitle && <><p className="eyebrow">{tune.kind || "TUNE"}, {tune.mode || "KEY UNKNOWN"}</p><h2>{tune.title}</h2></>}{showTitle && showPractice && <TuneAbility tune={tune} editable={practiceEditable} />}<p className="score-meta">{[!showTitle && tune.kind, !showTitle && tune.mode, tune.meter, tune.composer && `Composer: ${tune.composer}`, tune.contributor && `Setting by ${tune.contributor}`].filter(Boolean).join(", ")}</p></div><a onClick={() => trackEvent("tune_source_opened", {})} href={tune.sourceUrl} className="source-link" target="_blank" rel="noreferrer">View source</a></div>
    <div className="notation-frame"><div ref={paperRef} className="notation" aria-label={`Sheet music for ${tune.title}`} />{!ready && <p>Rendering score</p>}</div>
    <div className="player" aria-label={`Player for ${tune.title}`}><div className="player-primary"><Button size="icon" aria-label={playing ? "Pause" : "Play"} disabled={!ready || loading} onClick={() => { if (playing) { trackEvent("playback_paused", {}); pause(); } else void start(); }}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</Button><Button variant="ghost" size="icon" aria-label="Restart" onClick={() => { trackEvent("playback_restarted", {}); reset(); }}><RotateCcw size={16} /></Button><div className="note-display"><span>NOW PLAYING</span><strong>{note}</strong></div></div><div className="player-progress"><input type="range" min="0" max="100" value={progress} aria-label="Playback position" onPointerUp={() => trackEvent("playback_seeked", {})} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) trackEvent("playback_seeked", {}); }} onChange={(event) => void seek(Number(event.target.value))} /></div>{playalongs.length > 0 && <div className="playalong-choices" role="group" aria-label="Play along with"><button type="button" className="playalong-choice" aria-pressed={!track} onClick={() => void changeSound(String(instrument))}><Music2 size={14} aria-hidden="true" />Notes</button>{playalongs.map((entry) => <button type="button" key={entry.id} className="playalong-choice" aria-pressed={track?.id === entry.id} title={entry.otherSetting ? "Recorded from another setting of this tune in the same key" : undefined} onClick={() => void changeSound(`track:${entry.id}`)}><span aria-hidden="true">{leadEmoji(entry.label)}</span>{entry.label}{entry.otherSetting && <span className="playalong-other">other setting</span>}</button>)}</div>}<div className="player-options">{!track && <label>Sound<select value={instrument} onChange={(event) => void changeSound(event.target.value)}>{instruments.map((entry) => <option key={entry.program} value={entry.program}>{entry.label}</option>)}</select></label>}<label>Tempo <span>{speed}%</span><input type="range" min="50" max="150" step="5" value={speed} onChange={(event) => void changeSpeed(Number(event.target.value))} aria-label="Tempo percentage" onPointerUp={(event) => trackEvent("playback_tempo_changed", { tempo: Number(event.currentTarget.value) })} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) trackEvent("playback_tempo_changed", { tempo: Number(event.currentTarget.value) }); }} /></label><label className="volume-control"><Volume2 size={16} /><input type="range" min="0" max="100" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (playerRef.current.gain) playerRef.current.gain.gain.value = next / 100; if (playerRef.current.audio) playerRef.current.audio.volume = next / 100; }} aria-label="Volume" /></label></div>{showPractice && practiceEditable && <PracticeSpeed tune={tune} speed={speed} />}{loading && <p className="player-status">{track ? "Loading recording" : "Loading instrument"}</p>}{track && <p className="player-status">Play-along recording of {track.otherSetting ? "another setting of this tune in the same key" : "this setting"}, generated with <a href="https://huggingface.co/m-a-p/YuE2-3B" target="_blank" rel="noreferrer">YuE2</a>.</p>}{error && <p role="alert" className="form-error">{error}</p>}</div>
    <details className="abc-details" onToggle={(event) => { if (event.currentTarget.open) trackEvent("notation_opened", {}); }}><summary>ABC notation</summary><pre>{abcForTune(tune)}</pre></details><p className="attribution">Contains information from <a href="https://thesession.org" target="_blank" rel="noreferrer">The Session</a>, available under the <a href="https://github.com/adactio/TheSession-data/blob/main/LICENSE.md" target="_blank" rel="noreferrer">Open Database License</a>.</p>
  </article>;
}
