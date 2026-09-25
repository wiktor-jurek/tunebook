"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { getLibrary } from "@/lib/library";

type Tunes = Awaited<ReturnType<typeof getLibrary>>["tunes"];
export function BookTuneControls({ bookId, available, tuneId, direction, icon }: { bookId: string; available?: Tunes; tuneId?: string; direction?: "up" | "down"; icon?: React.ReactNode }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function update(operation: string, selectedTuneId: string, moveDirection?: string) {
    setError("");
    const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, bookId, tuneId: selectedTuneId, direction: moveDirection }) });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Could not update tunebook"); else router.refresh();
  }
  if (tuneId) return <Button variant="ghost" size="icon" disabled={!direction} aria-label={`Move tune ${direction || "unavailable"}`} onClick={() => direction && void update("moveTune", tuneId, direction)}>{icon}</Button>;
  return <div className="book-add"><label className="field-label">Add saved tune<select className="input" value="" onChange={(event) => { if (event.target.value) void update("addToBook", event.target.value); }}><option value="">Choose a tune…</option>{available?.map((tune) => <option key={tune.id} value={tune.id}>{tune.title}</option>)}</select></label>{error && <span role="alert" className="inline-error">{error}</span>}</div>;
}
