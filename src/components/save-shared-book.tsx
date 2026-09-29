"use client";

import { trackEvent } from "@/lib/analytics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookPlus, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SaveSharedBook({ bookId, tuneId, signedIn, alreadySaved = false }: { bookId: string; tuneId?: string; signedIn: boolean; alreadySaved?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  if (!signedIn) return <div className="shared-save"><Button asChild variant="outline" size={tuneId ? "sm" : "default"}><Link onClick={() => trackEvent("guest_save_sign_in", { kind: tuneId ? "tune" : "book" })} href={`/sign-in?next=${encodeURIComponent(`/books/${bookId}`)}`}>{tuneId ? <Plus size={14} /> : <BookPlus size={15} />}{tuneId ? "Log in to save tune" : "Log in to save tunebook"}</Link></Button></div>;
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/books/${bookId}/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tuneId ? { operation: "tune", tuneId } : { operation: "book" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save to your library");
      trackEvent(tuneId ? "shared_tune_saved" : "shared_book_saved", { outcome: "success" });
      if (result.bookId) router.push(`/books/${result.bookId}`);
      else setSaved(true);
      router.refresh();
    } catch (cause) { trackEvent(tuneId ? "shared_tune_saved" : "shared_book_saved", { outcome: "error" }); setError(cause instanceof Error ? cause.message : "Could not save to your library"); }
    finally { setBusy(false); }
  }
  const isSaved = tuneId && (saved || alreadySaved);
  return <div className="shared-save"><Button variant="outline" size={tuneId ? "sm" : "default"} disabled={busy || !!isSaved} onClick={() => void save()}>{isSaved ? <Check size={14} /> : tuneId ? <Plus size={14} /> : <BookPlus size={15} />}{busy ? "Saving" : isSaved ? "Saved" : tuneId ? "Save tune" : "Save a copy"}</Button>{error && <span role="alert" className="inline-error">{error}</span>}</div>;
}
