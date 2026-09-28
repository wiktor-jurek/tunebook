"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Link2, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Setting = { settingId: number; title: string; kind: string | null; mode: string | null; meter: string | null; contributor: string | null; sourceUrl: string };

export function InlineTuneImport() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<Setting[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function saveSetting(settingId: number) {
    try {
      const response = await fetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settingId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the tune");
      trackEvent("tune_saved", { outcome: "success" });
      setOpen(false); setQuery(""); setSettings([]); setMessage("Tune saved to your library."); router.refresh();
    } catch (cause) { trackEvent("tune_saved", { outcome: "error" }); throw cause; }
  }

  async function lookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    let lookedUp = false;
    try {
      const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not find the tune");
      const found: Setting[] = result.settings;
      lookedUp = true;
      trackEvent("tune_lookup", { source: /^https?:\/\//i.test(query.trim()) ? "url" : "title", outcome: "success", result_count: found.length });
      if (!found.length) throw new Error("No settings found. Try a tune title or another The Session URL.");
      if (found.length === 1) await saveSetting(found[0].settingId);
      else { setSettings(found); setOpen(true); }
    } catch (cause) { if (!lookedUp) trackEvent("tune_lookup", { source: /^https?:\/\//i.test(query.trim()) ? "url" : "title", outcome: "error" }); setError(cause instanceof Error ? cause.message : "Could not find the tune"); }
    finally { setBusy(false); }
  }

  async function choose(settingId: number) {
    setBusy(true); setError("");
    try { await saveSetting(settingId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the tune"); }
    finally { setBusy(false); }
  }

  return <div className="inline-import">
    <form onSubmit={lookup} className="inline-import-form" aria-busy={busy}><Link2 size={18} aria-hidden="true" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setMessage(""); }} placeholder="Paste a The Session tune URL, or search by title" aria-label="Tune URL or title" required maxLength={200} disabled={busy} /><Button disabled={busy}><Plus size={15} /> {busy ? "Adding…" : "Add tune"}</Button></form>
    {!open && error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content setting-dialog"><div className="setting-dialog-head"><Dialog.Title className="dialog-title">Choose a setting</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close settings"><X size={17} /></Button></Dialog.Close></div><Dialog.Description className="muted">{settings.length} settings found. Save the version you want to play.</Dialog.Description>{error && <p className="form-error" role="alert">{error}</p>}<div className="setting-results">{settings.map((setting) => <article className="setting-result" key={setting.settingId}><div><h3>{setting.title}</h3><p className="tune-list-meta">{[setting.kind, setting.mode, setting.meter].filter(Boolean).join(" · ")}</p><p className="tune-list-meta">Setting #{setting.settingId}{setting.contributor && ` · by ${setting.contributor}`}</p><a className="setting-source" href={setting.sourceUrl} target="_blank" rel="noreferrer">View setting ↗</a></div><Button size="sm" disabled={busy} onClick={() => void choose(setting.settingId)}>Save</Button></article>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
