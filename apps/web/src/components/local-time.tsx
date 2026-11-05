"use client";

import { useSyncExternalStore } from "react";
import { sessionName } from "@/lib/session-names";

const noop = () => () => undefined;

/** A time of day in the viewer's own time zone. The server cannot know it, so it renders nothing there and the browser fills it in. */
export function LocalTime({ iso, prefix = "" }: { iso: string; prefix?: string }) {
  const text = useSyncExternalStore(noop, () => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), () => "");
  return text ? <time dateTime={iso}>{prefix}{text}</time> : null;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DAY_MS = 86_400_000;

/** How long ago a moment was, in calendar days of the viewer's time zone: "today", "yesterday", "3 days ago", "last month", "2 years ago". */
export function timeAgo(then: Date, now = new Date()) {
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(then)) / DAY_MS);
  if (days < 7) return RELATIVE.format(-days, "day");
  if (days < 30) return RELATIVE.format(-Math.floor(days / 7), "week");
  const months = (now.getFullYear() - then.getFullYear()) * 12 + now.getMonth() - then.getMonth();
  if (months < 12) return RELATIVE.format(-Math.max(1, months), "month");
  return RELATIVE.format(-Math.floor(months / 12), "year");
}

/** A session named for when it was, in the viewer's time ("Last night"); the server shows [fallback], its day. */
export function SessionName({ iso, fallback }: { iso: string; fallback: string }) {
  const text = useSyncExternalStore(noop, () => sessionName(new Date(iso)), () => fallback);
  return <>{text}</>;
}

/** `timeAgo` in the browser, where the viewer's time zone and today are known; the server renders nothing. */
export function TimeAgo({ iso, suffix = "" }: { iso: string; suffix?: string }) {
  const text = useSyncExternalStore(noop, () => timeAgo(new Date(iso)), () => "");
  return text ? <time dateTime={iso}>{text.charAt(0).toUpperCase() + text.slice(1)}{suffix}</time> : null;
}
