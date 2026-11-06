"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { nameTunesInFile, type NamingStep } from "@/lib/finder/name-file";
import { addRecordingFile } from "@/lib/finder/use-recorder";
import { RECORDING_ACCEPT, recordingType } from "@/lib/recording-types";

const percent = (progress: number) => `${Math.round(100 * progress)}%`;
const stepText = (step: NamingStep) =>
  step.step === "reading" ? "Reading the recording"
  : step.step === "loading" ? `Getting the tune finder ready${step.progress ? `, ${percent(step.progress)}` : ""}`
  : step.step === "listening" ? `Naming the tunes, ${percent(step.progress)}`
  : "Writing the setlist";

/**
 * Upload recording, on the Sessions screen: an audio file from the phone's own recorder (or anywhere) becomes a session.
 * The finder listens through it on this device first, as it would have at the session, so it arrives with its setlist;
 * then it joins "On this device" and uploads like a session recorded here.
 */
export function UploadRecording() {
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<NamingStep | null>(null);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setError("");
    const mime = recordingType(file.type, file.name);
    if (!mime) { setError("That isn't an audio file this can store (try M4A, MP3, WAV, WebM, Ogg or FLAC)."); return; }
    try {
      const { durationMs, tunes } = await nameTunesInFile(file, setStep);
      // A phone stamps a recording's file when it stops, so the session began its length earlier.
      const recordedAt = new Date((file.lastModified || Date.now()) - durationMs);
      setStep(null);
      trackEvent("session_recording_imported", { outcome: "success", tune_count: tunes.length });
      await addRecordingFile(file, { id: crypto.randomUUID(), name: `Session, ${recordedAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`,
        mime, recordedAt: recordedAt.toISOString(), durationMs, tunes, finished: true });
    } catch (cause) {
      trackEvent("session_recording_imported", { outcome: "error", tune_count: 0 });
      setStep(null); setError(cause instanceof Error ? cause.message : "Could not read the recording");
    }
  }

  return <div className="upload-recording">
    <input ref={input} type="file" accept={RECORDING_ACCEPT} hidden onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void upload(file);
    }} />
    <Button size="sm" variant="outline" disabled={!!step} onClick={() => input.current?.click()}><Upload size={14} /> Upload recording</Button>
    {(step || error) && <p className={`upload-recording-status ${error ? "is-error" : ""}`} role="status" aria-live="polite">{step ? stepText(step) : error}</p>}
  </div>;
}
