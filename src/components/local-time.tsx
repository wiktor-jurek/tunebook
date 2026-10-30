"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => undefined;

/** A time of day in the viewer's own time zone. The server cannot know it, so it renders nothing there and the browser fills it in. */
export function LocalTime({ iso, prefix = "" }: { iso: string; prefix?: string }) {
  const text = useSyncExternalStore(noop, () => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), () => "");
  return text ? <time dateTime={iso}>{prefix}{text}</time> : null;
}
