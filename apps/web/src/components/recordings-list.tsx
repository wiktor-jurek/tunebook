"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clock } from "@/components/finder-parts";
import { usePendingRecordings, type LocalRecording, type UploadState } from "@/lib/finder/use-recorder";

const named = (r: LocalRecording) => { const n = r.tunes.filter((t) => !t.rejected).length; return n ? `${n} ${n === 1 ? "tune" : "tunes"} named` : "no tunes named"; };
const progressText = (r: LocalRecording, state?: UploadState) =>
  !state ? `${clock(r.durationMs)}, ${named(r)}. Not uploaded yet.`
  : state.status === "preparing" ? "Getting it ready"
  : state.status === "sending" ? `Uploading, ${Math.round(100 * state.progress)}%`
  : state.status === "saving" ? "Saving the setlist"
  : state.status === "done" ? "Uploaded"
  : state.error ?? "The upload stopped";

/**
 * The Recordings list: recordings still on this device come first, each to upload or discard, then the uploaded ones
 * (the server's rows, passed as children). Uploading, a row fills its ring as the audio goes, ticks when it arrives,
 * and a moment later takes its place among the others.
 */
export function RecordingsList({ hasUploaded, empty, children }: { hasUploaded: boolean; empty: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const { pending, uploads, retry, discard } = usePendingRecordings();
  const [discarding, setDiscarding] = useState<LocalRecording | null>(null);
  // A recording that just uploaded has left the device but keeps its row until its tick has shown.
  const arriving = Object.values(uploads).filter((state) => state.status === "done" && !pending.some((r) => r.id === state.id)).map((state) => state.recording);
  const rows = [...pending, ...arriving].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  // When one leaves the list for good, the uploaded list below is fetched again, with it in.
  const count = useRef(rows.length);
  useEffect(() => { if (rows.length < count.current) router.refresh(); count.current = rows.length; }, [rows.length, router]);

  if (!rows.length && !hasUploaded) return empty;
  return <>
    <ul className="session-group recordings-list">
      {rows.map((r) => {
        const state = uploads[r.id], working = !!state && state.status !== "failed" && state.status !== "done";
        return <li key={r.id} className="session-row pending-row" data-status={state?.status ?? "waiting"}>
          <UploadMark state={state} />
          <span className="session-row-text"><span className="session-row-title">{r.name}</span>
            <span className="session-row-meta pending-meta" role="status" aria-live="polite">{progressText(r, state)}</span></span>
          {!working && state?.status !== "done" && <span className="pending-actions">
            <Button size="sm" onClick={() => void retry(r)}><CloudUpload size={14} /> {state?.status === "failed" ? "Try again" : "Upload"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDiscarding(r)}>Discard</Button>
          </span>}
          {state && state.status !== "failed" && <span className="pending-bar" aria-hidden="true"><span style={{ transform: `scaleX(${state.status === "preparing" ? 0.04 : state.progress})` }} /></span>}
        </li>;
      })}
      {children}
    </ul>
    <ConfirmDialog open={!!discarding} onOpenChange={(value) => { if (!value) setDiscarding(null); }} title={`Discard ${discarding?.name ?? "this recording"}?`}
      description="It was never uploaded, so the audio and its setlist will be gone for good." action="Discard"
      onConfirm={() => { if (discarding) void discard(discarding.id); setDiscarding(null); }} />
  </>;
}

/** The row's icon: a cloud while it waits, a ring filling as it uploads, then a tick. */
function UploadMark({ state }: { state?: UploadState }) {
  if (state?.status === "done") return <span className="session-row-emoji upload-mark is-done" aria-hidden="true"><Check size={16} strokeWidth={3} /></span>;
  if (!state || state.status === "failed") return <span className="session-row-emoji upload-mark" aria-hidden="true"><CloudUpload size={18} /></span>;
  const fill = state.status === "sending" ? state.progress : 1;
  return <span className="session-row-emoji upload-mark is-working" data-status={state.status} aria-hidden="true">
    <svg viewBox="0 0 36 36"><circle className="upload-track" cx="18" cy="18" r="15" /><circle className="upload-fill" cx="18" cy="18" r="15" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - 100 * fill} /></svg>
  </span>;
}
