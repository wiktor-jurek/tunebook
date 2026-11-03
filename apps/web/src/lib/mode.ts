import { headers } from "next/headers";
import { userAgentFromString } from "next/server";

// The layout follows the device: a phone gets the session layout (tabs, the listen deck, the swipe-through reader, no
// editing); anything else gets the full app (sidebar, editing, the inline player, the listen dock).
export type Mode = "practice" | "session";

/** Phones get the session layout; desktops and tablets the full app. */
export function modeFor(userAgent: string | undefined): Mode {
  return userAgentFromString(userAgent).device.type === "mobile" ? "session" : "practice";
}

/** The layout for this request's device. */
export async function getMode(): Promise<{ mode: Mode }> {
  return { mode: modeFor((await headers()).get("user-agent") ?? undefined) };
}
