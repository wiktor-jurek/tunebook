"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clock } from "@/components/finder-parts";
import { usePendingRecordings, type LocalRecording } from "@/lib/finder/use-recorder";

const named = (r: LocalRecording) => { const n = r.tunes.filter((t) => !t.rejected).length; return `${clock(r.durationMs)}, ${n ? `${n} ${n === 1 ? "tune" : "tunes"} named` : "no tunes named"}`; };

/** Recordings still on this device, not yet uploaded: each can be uploaded (again) or thrown away. */
export function PendingRecordings({ session }: { session: boolean }) {
  const router = useRouter();
  const { pending, uploads, retry, discard } = usePendingRecordings();
  const [discarding, setDiscarding] = useState<LocalRecording | null>(null);
  // One that finishes uploading leaves this list and joins the uploaded ones below.
  const count = useRef(pending.length);
  useEffect(() => { if (pending.length < count.current) router.refresh(); count.current = pending.length; }, [pending.length, router]);
  if (!pending.length) return null;
  return <section className="pending-recordings" aria-label="Not uploaded yet">
    <p className={session ? "session-group-title" : "pending-title"}>On this device, not uploaded yet</p>
    <ul className="session-group">{pending.map((r) => {
      const state = uploads[r.id];
      return <li key={r.id} className="session-row pending-row" role="status">
        <span className="session-row-emoji" aria-hidden="true"><CloudUpload size={18} /></span>
        <span className="session-row-text"><span className="session-row-title">{r.name}</span><span className={state?.status === "failed" ? "session-row-meta form-error" : "session-row-meta"}>{state?.status === "failed" ? state.error : named(r)}</span></span>
        {state?.status === "uploading" ? <span className="pending-state">Uploading</span> : <span className="pending-actions">
          <button type="button" className="finder-link" onClick={() => void retry(r)}>{state?.status === "failed" ? "Retry" : "Upload"}</button>
          <button type="button" className="finder-link" onClick={() => setDiscarding(r)}>Discard</button>
        </span>}
      </li>;
    })}</ul>
    <ConfirmDialog open={!!discarding} onOpenChange={(value) => { if (!value) setDiscarding(null); }} title={`Discard ${discarding?.name ?? "this recording"}?`} description="It has not been uploaded, so it will be gone for good." action="Discard" onConfirm={() => { if (discarding) void discard(discarding.id); setDiscarding(null); }} />
  </section>;
}
