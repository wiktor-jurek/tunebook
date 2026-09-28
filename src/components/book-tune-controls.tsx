"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { getLibrary } from "@/lib/library";

type Library = Awaited<ReturnType<typeof getLibrary>>;
export function BookTuneControls({ bookId, available, sets }: { bookId: string; available: Library["tunes"]; sets: Library["sets"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function add(kind: "tune" | "set", id: string) {
    if (!id || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(kind === "set" ? "/api/sets" : "/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "set" ? { operation: "add", bookId, setId: id } : { operation: "addToBook", bookId, tuneId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update tunebook");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update tunebook"); }
    finally { setBusy(false); }
  }
  return <div className="book-add book-add-items"><label className="field-label">Add tune<select className="input" value="" disabled={busy} onChange={(event) => void add("tune", event.target.value)}><option value="">Choose a saved tune…</option>{available.map((tune) => <option key={tune.id} value={tune.id}>{tune.title}</option>)}</select></label><label className="field-label">Add set<select className="input" value="" disabled={busy || !sets.length} onChange={(event) => void add("set", event.target.value)}><option value="">{sets.length ? "Choose a saved set…" : "Group tunes below to create a set"}</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.name} · {set.tunes.length} tunes</option>)}</select></label><Link className="book-my-sets" href="/sets">My sets</Link>{error && <span role="alert" className="inline-error">{error}</span>}</div>;
}
