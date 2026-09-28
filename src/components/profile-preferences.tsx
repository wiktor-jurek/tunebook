"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { SOUND_OPTIONS } from "@/lib/sounds";

export function ProfilePreferences({ userName, defaultSound }: { userName: string; defaultSound: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(defaultSound);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultSound: sound }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save preferences");
      trackEvent("preferences_saved", { outcome: "success", instrument: sound });
      setOpen(false); router.refresh();
    } catch (cause) { trackEvent("preferences_saved", { outcome: "error", instrument: sound }); setError(cause instanceof Error ? cause.message : "Could not save preferences"); }
    finally { setBusy(false); }
  }

  return <Dialog.Root open={open} onOpenChange={(value) => { setOpen(value); if (value) { setSound(defaultSound); setError(""); } }}>
    <Dialog.Trigger asChild><button className="profile-button" aria-label={`Preferences for ${userName}`}><span className="user-initial">{userName.charAt(0).toUpperCase()}</span><span className="user-name">{userName}</span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><Dialog.Title className="dialog-title">Your preferences</Dialog.Title><Dialog.Description className="muted">Choose the sound new score players use by default.</Dialog.Description><form onSubmit={save}><label className="field-label">Preferred default sound<select className="input" value={sound} onChange={(event) => setSound(Number(event.target.value))}>{SOUND_OPTIONS.map((entry) => <option key={entry.program} value={entry.program}>{entry.label}</option>)}</select></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><Dialog.Close asChild><Button type="button" variant="outline">Cancel</Button></Dialog.Close><Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div></form></Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
