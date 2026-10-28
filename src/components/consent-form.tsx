"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function ConsentForm({ clientName, clientUri, userName, permissions }: { clientName: string; clientUri: string | null; userName: string; permissions: string[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function respond(accept: boolean) {
    setBusy(true); setError("");
    // The OAuth client plugin attaches this page's signed query; a success redirects back to the app.
    const result = await authClient.oauth2.consent({ accept });
    if (result.error) { setError(result.error.message || "Could not complete the request. Start again from the app."); setBusy(false); }
  }
  return <main className="auth-screen"><div className="auth-card"><Link href="/" className="brand auth-brand"><BrandMark /><span>Tunebook</span></Link><p className="eyebrow">CONNECT AN APP</p><h1>Allow access?</h1>
    <p className="page-subtitle"><strong>{clientName}</strong>{clientUri && URL.canParse(clientUri) && <> ({new URL(clientUri).host})</>} wants to use your Libresession account, {userName}. It will be able to:</p>
    <ul className="consent-list">{permissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
    <p className="muted">Only allow apps you trust. AI assistants act on your behalf with these permissions.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="consent-actions"><Button variant="outline" disabled={busy} onClick={() => respond(false)}>Deny</Button><Button disabled={busy} onClick={() => respond(true)}>{busy ? "Working" : "Allow"}</Button></div>
  </div></main>;
}
