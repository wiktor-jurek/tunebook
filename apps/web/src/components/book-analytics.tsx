"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";

export function BookAnalytics({ bookName, isOwner, signedIn, tuneCount, setCount }: { bookName: string; isOwner: boolean; signedIn: boolean; tuneCount: number; setCount: number }) {
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    trackEvent("tunebook_opened", { access: isOwner ? "owner" : "viewer", signed_in: signedIn, tune_count: tuneCount, set_count: setCount, book: bookName });
  }, [bookName, isOwner, signedIn, tuneCount, setCount]);
  return null;
}
