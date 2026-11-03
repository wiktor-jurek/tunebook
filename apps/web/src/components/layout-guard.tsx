"use client";

import { useEffect } from "react";
import type { Mode } from "@/lib/mode";

// The server picks the layout from the device. If the screen stops matching it (DevTools switching device, a window
// dragged to another screen), the page reloads once so the server can choose again. A phone is a touch screen with a
// side under 500px; a desktop has a mouse and is at least 900px wide. Anything between keeps what it has, and a live
// recording is never interrupted.
const PHONE = "(pointer: coarse) and ((max-width: 500px) or (max-height: 500px))";
const DESKTOP = "(pointer: fine) and (min-width: 900px)";

export function LayoutGuard({ mode }: { mode: Mode }) {
  useEffect(() => {
    const queries = [window.matchMedia(PHONE), window.matchMedia(DESKTOP)];
    const check = () => {
      const wrong = mode === "session" ? queries[1].matches : queries[0].matches;
      if (wrong && !document.querySelector(".deck.is-recording")) window.location.reload();
    };
    queries.forEach((query) => query.addEventListener("change", check));
    return () => queries.forEach((query) => query.removeEventListener("change", check));
  }, [mode]);
  return null;
}
