"use client";

import { trackEvent } from "@/lib/analytics";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Globe, LockKeyhole, Share2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Settings = { linkVisible: boolean; shares: { email: string }[] };

export function ShareBookDialog({ bookId, name, ownerName, ownerEmail }: { bookId: string; name: string; ownerName: string; ownerEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const endpoint = `/api/books/${bookId}/sharing`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load sharing settings");
      setSettings(result);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load sharing settings"); });
    return () => controller.abort();
  }, [open, endpoint, reload]);

  function trackResult(body: { operation: "invite" | "remove" } | { operation: "visibility"; linkVisible: boolean }, outcome: "success" | "error", warning = false) {
    if (body.operation === "invite") trackEvent("book_shared_by_email", { outcome, ...(outcome === "success" ? { delivery: warning ? "warning" as const : "sent" as const } : {}) });
    else if (body.operation === "remove") trackEvent("book_share_removed", { outcome });
    else if (body.operation === "visibility") trackEvent("book_visibility_changed", { outcome, visibility: body.linkVisible ? "public" : "restricted" });
  }

  async function update(body: { operation: "invite" | "remove"; email: string } | { operation: "visibility"; linkVisible: boolean }) {
    if (busy || !settings) return;
    setBusy(true); setError(""); setMessage(""); setCopied(false);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update sharing settings");
      trackResult(body, "success", Boolean(result.warning));
      if (body.operation === "visibility") setSettings({ ...settings, linkVisible: body.linkVisible });
      else if (body.operation === "remove") setSettings({ ...settings, shares: settings.shares.filter((share) => share.email !== body.email) });
      else {
        const normalized = body.email.toLowerCase();
        setSettings({ ...settings, shares: [...settings.shares.filter((share) => share.email !== normalized), { email: normalized }].sort((a, b) => a.email.localeCompare(b.email)) });
        setEmail("");
      }
      setMessage(result.warning || (body.operation === "invite" ? "Tunebook shared." : body.operation === "remove" ? "Access removed." : "General access updated."));
      router.refresh();
    } catch (cause) { trackResult(body, "error"); setError(cause instanceof Error ? cause.message : "Could not update sharing settings"); }
    finally { setBusy(false); }
  }

  return <Dialog.Root open={open} onOpenChange={(next) => { if (busy) return; if (next) trackEvent("share_dialog_opened", {}); setOpen(next); setSettings(null); setError(""); setMessage(""); setCopied(false); setEmail(""); }}>
    <Dialog.Trigger asChild><Button variant="outline"><Share2 size={15} />Share</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content share-dialog" onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
        <header className="library-dialog-head"><div><Dialog.Title className="dialog-title">Share {name}</Dialog.Title><Dialog.Description className="library-dialog-description">Share scores and playback. People you share with can view this tunebook.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" disabled={busy} aria-label="Close sharing dialog"><X size={18} /></button></Dialog.Close></header>
        <div className="share-dialog-body">
          <form className="share-invite-form" onSubmit={(event) => { event.preventDefault(); void update({ operation: "invite", email: email.trim() }); }}>
            <label className="field-label">Share by email<Input type="email" autoComplete="email" placeholder="Add an email address" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy || !settings} /></label>
            <Button disabled={busy || !settings || !email.trim()} type="submit">Share</Button>
          </form>
          {!settings && !error && <p className="muted" role="status">Loading sharing settings</p>}
          {settings && <>
            <section className="share-people" aria-labelledby="share-people-title"><h2 id="share-people-title">People with access</h2>
              <div className="share-person"><span className="share-avatar"><UserRound size={18} /></span><div><strong>{ownerName} (you)</strong><span>{ownerEmail}</span></div><span className="share-role">Owner</span></div>
              {settings.shares.map((share) => <div className="share-person" key={share.email}><span className="share-avatar"><UserRound size={18} /></span><div><strong>{share.email}</strong><span>Viewer</span></div><Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove access for ${share.email}`} onClick={() => void update({ operation: "remove", email: share.email })}>Remove</Button></div>)}
            </section>
            <section className="share-general" aria-labelledby="share-general-title"><h2 id="share-general-title">General access</h2><div className="share-access-row"><span className={`share-avatar ${settings.linkVisible ? "share-public" : ""}`}>{settings.linkVisible ? <Globe size={19} /> : <LockKeyhole size={18} />}</span><div><label className="sr-only" htmlFor="share-visibility">General access</label><select id="share-visibility" className="input" disabled={busy} value={settings.linkVisible ? "public" : "restricted"} onChange={(event) => void update({ operation: "visibility", linkVisible: event.target.value === "public" })}><option value="restricted">Restricted</option><option value="public">Anyone with the link</option></select><p>{settings.linkVisible ? "Anyone with the link can view, without logging in." : "Only you and people added by email can open this tunebook."}</p></div><span className="share-role">Viewer</span></div></section>
          </>}
          {error && <p role="alert" className="form-error">{error}{!settings && <Button variant="ghost" size="sm" onClick={() => { setError(""); setReload((value) => value + 1); }}>Try again</Button>}</p>}
          {message && <p role="status" className="muted">{message}</p>}
        </div>
        <footer className="library-dialog-footer share-dialog-footer"><Button variant="outline" disabled={busy || !settings} onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/books/${bookId}`); trackEvent("book_link_copied", { outcome: "success" }); setCopied(true); setError(""); } catch { trackEvent("book_link_copied", { outcome: "error" }); setError("Could not copy the link. Copy this page's address from your browser."); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</Button><span className="sr-only" role="status">{copied ? "Link copied to clipboard" : ""}</span><Dialog.Close asChild><Button disabled={busy}>Done</Button></Dialog.Close></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
