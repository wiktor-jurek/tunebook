"use client";

import { useEffect, useRef, useState } from "react";
import abcjs from "abcjs";
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { savedTunes } from "@/db/schema";
import { abcForTune, noteNames } from "@/lib/notation";
import { DEFAULT_SOUND, SOUND_OPTIONS } from "@/lib/sounds";

type Tune = typeof savedTunes.$inferSelect;
type Visual = ReturnType<typeof abcjs.renderAbc>[number];
type Player = { buffer?: AudioBuffer; key?: string; source?: AudioBufferSourceNode; gain?: GainNode; startedAt: number; offset: number; timer?: abcjs.TimingCallbacks; raf?: number; playing: boolean };
let sharedContext: AudioContext | null = null;
const instruments = SOUND_OPTIONS;

export function Score({ tune, defaultSound = DEFAULT_SOUND }: { tune: Tune; defaultSound?: number }) {
  const paperRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<Visual | null>(null);
  const playerRef = useRef<Player>({ startedAt: 0, offset: 0, playing: false });
  const tokenRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [soundOverride, setInstrument] = useState<number | null>(null);
  const instrument = soundOverride ?? defaultSound;
  const [speed, setSpeed] = useState(100);
  const [volume, setVolume] = useState(75);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState("—");
  const [activeElements, setActiveElements] = useState<HTMLElement[]>([]);
  const scoreId = tune.id;

  useEffect(() => {
    if (!paperRef.current) return;
    const player = playerRef.current;
    const result = abcjs.renderAbc(paperRef.current, abcForTune(tune), { responsive: "resize", add_classes: true, staffwidth: 760, paddingtop: 0, paddingbottom: 0 });
    visualRef.current = result[0] || null;
    setReady(Boolean(result[0]));
    return () => {
      player.source?.stop(); player.timer?.stop();
      if (player.raf) cancelAnimationFrame(player.raf);
      player.playing = false;
    };
  }, [tune]);

  useEffect(() => {
    for (const element of activeElements) element.classList.add("playing-note");
    return () => { for (const element of activeElements) element.classList.remove("playing-note"); };
  }, [activeElements]);

  useEffect(() => {
    function otherPlayer(event: Event) {
      if ((event as CustomEvent<string>).detail !== scoreId) pause();
    }
    window.addEventListener("tunebook:play", otherPlayer);
    return () => window.removeEventListener("tunebook:play", otherPlayer);
  }, [scoreId]);

  function pause() {
    const p = playerRef.current;
    if (!p.playing) return;
    p.offset = Math.min(p.buffer?.duration || 0, sharedContext!.currentTime - p.startedAt);
    p.source?.stop(); p.source = undefined; p.timer?.pause();
    if (p.raf) cancelAnimationFrame(p.raf);
    p.playing = false; setPlaying(false);
  }
  function reset() {
    pause();
    const p = playerRef.current;
    p.offset = 0; p.timer?.reset(); setProgress(0); setNote("—"); setActiveElements([]);
  }
  function tick() {
    const p = playerRef.current;
    if (!p.playing || !p.buffer || !sharedContext) return;
    setProgress(Math.min(100, Math.round((sharedContext.currentTime - p.startedAt) / p.buffer.duration * 100)));
    p.raf = requestAnimationFrame(tick);
  }
  async function start(nextInstrument = instrument, nextSpeed = speed, offsetRatio?: number) {
    const visual = visualRef.current;
    if (!visual || !abcjs.synth.supportsAudio()) { setError("Audio is unavailable in this browser"); return; }
    const p = playerRef.current;
    const token = ++tokenRef.current;
    setLoading(true); setError("");
    try {
      sharedContext ||= new AudioContext();
      await sharedContext.resume();
      const key = `${nextInstrument}:${nextSpeed}`;
      if (p.key !== key || !p.buffer) {
        const synth = new abcjs.synth.CreateSynth();
        const result = await synth.init({ visualObj: visual, audioContext: sharedContext, options: { program: nextInstrument, qpm: nextSpeed, soundFontUrl: "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/" } });
        if (result.error.length) throw new Error("Some instrument notes could not be loaded");
        await synth.prime();
        if (token !== tokenRef.current) return;
        p.buffer = synth.getAudioBuffer(); p.key = key;
        if (!p.buffer) throw new Error("Could not prepare audio");
        p.timer?.stop();
        p.timer = new abcjs.TimingCallbacks(visual, { qpm: nextSpeed, eventCallback: (event) => {
          setNote(noteNames(event?.midiPitches));
          setActiveElements(event?.elements?.flat() as HTMLElement[] || []);
          return undefined;
        } });
      }
      if (token !== tokenRef.current || !p.buffer) return;
      const source = sharedContext.createBufferSource();
      const gain = sharedContext.createGain();
      source.buffer = p.buffer; gain.gain.value = volume / 100;
      source.connect(gain).connect(sharedContext.destination);
      p.offset = offsetRatio !== undefined ? Math.min(p.buffer.duration - 0.01, Math.max(0, offsetRatio * p.buffer.duration)) : p.offset;
      p.source = source; p.gain = gain;
      p.startedAt = sharedContext.currentTime - p.offset;
      source.onended = () => { if (p.source === source && p.playing) { p.playing = false; p.source = undefined; p.offset = 0; p.timer?.stop(); setPlaying(false); setProgress(0); setNote("—"); setActiveElements([]); if (p.raf) cancelAnimationFrame(p.raf); } };
      source.start(0, p.offset);
      p.timer?.start(p.offset, "seconds");
      p.playing = true; setPlaying(true); tick();
      window.dispatchEvent(new CustomEvent("tunebook:play", { detail: scoreId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Audio failed"); }
    finally { if (token === tokenRef.current) setLoading(false); }
  }
  async function changeSound(program: number) {
    const p = playerRef.current;
    const ratio = p.buffer ? (p.playing && sharedContext ? sharedContext.currentTime - p.startedAt : p.offset) / p.buffer.duration : 0;
    const wasPlaying = p.playing;
    pause(); setInstrument(program);
    if (wasPlaying) await start(program, speed, ratio);
  }
  async function changeSpeed(value: number) {
    const p = playerRef.current;
    const ratio = p.buffer ? (p.playing && sharedContext ? sharedContext.currentTime - p.startedAt : p.offset) / p.buffer.duration : 0;
    const wasPlaying = p.playing;
    pause(); setSpeed(value);
    if (wasPlaying) await start(instrument, value, ratio);
  }
  async function seek(value: number) {
    const wasPlaying = playerRef.current.playing;
    pause();
    const p = playerRef.current;
    p.offset = p.buffer ? value / 100 * p.buffer.duration : 0;
    p.timer?.setProgress(value / 100);
    setProgress(value);
    if (wasPlaying) await start(instrument, speed, value / 100);
  }
  return <article className="score-sheet"><div className="score-header"><div><p className="eyebrow">{tune.kind || "TUNE"} · {tune.mode || "KEY UNKNOWN"}</p><h2>{tune.title}</h2><p className="score-meta">{[tune.meter, tune.composer && `Composer: ${tune.composer}`, tune.contributor && `Setting by ${tune.contributor}`].filter(Boolean).join(" · ")}</p></div><a href={tune.sourceUrl} className="source-link" target="_blank" rel="noreferrer">View source ↗</a></div>
    <div className="notation-frame"><div ref={paperRef} className="notation" aria-label={`Sheet music for ${tune.title}`} />{!ready && <p>Rendering score…</p>}</div>
    <div className="player" aria-label={`Player for ${tune.title}`}><div className="player-primary"><Button size="icon" aria-label={playing ? "Pause" : "Play"} disabled={!ready || loading} onClick={() => playing ? pause() : void start()}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</Button><Button variant="ghost" size="icon" aria-label="Restart" onClick={reset}><RotateCcw size={16} /></Button><div className="note-display"><span>NOW PLAYING</span><strong>{note}</strong></div></div><div className="player-progress"><input type="range" min="0" max="100" value={progress} aria-label="Playback position" onChange={(event) => void seek(Number(event.target.value))} /></div><div className="player-options"><label>Sound<select value={instrument} onChange={(event) => void changeSound(Number(event.target.value))}>{instruments.map((entry) => <option key={entry.program} value={entry.program}>{entry.label}</option>)}</select></label><label>Tempo <span>{speed}%</span><input type="range" min="50" max="150" step="5" value={speed} onChange={(event) => void changeSpeed(Number(event.target.value))} aria-label="Tempo percentage" /></label><label className="volume-control"><Volume2 size={16} /><input type="range" min="0" max="100" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (playerRef.current.gain) playerRef.current.gain.gain.value = next / 100; }} aria-label="Volume" /></label></div>{loading && <p className="player-status">Loading instrument…</p>}{error && <p role="alert" className="form-error">{error}</p>}</div>
    <details className="abc-details"><summary>ABC notation</summary><pre>{abcForTune(tune)}</pre></details><p className="attribution">Contains information from <a href="https://thesession.org" target="_blank" rel="noreferrer">The Session</a>, available under the <a href="https://github.com/adactio/TheSession-data/blob/main/LICENSE.md" target="_blank" rel="noreferrer">Open Database License</a>.</p>
  </article>;
}
