import { cookies, headers } from "next/headers";
import { userAgentFromString } from "next/server";

// Practice mode is the full app for planning and learning at home; session mode is the phone in the pub.
export type Mode = "practice" | "session";
export const MODE_COOKIE = "mode";

/** Phones are always in session mode; elsewhere the mode cookie can switch to it. */
export function modeFor(userAgent: string | undefined, cookie: string | undefined): Mode {
  if (userAgentFromString(userAgent).device.type === "mobile") return "session";
  return cookie === "session" ? "session" : "practice";
}

/** The current mode, and whether the person can switch (phones cannot leave session mode). */
export async function getMode(): Promise<{ mode: Mode; switchable: boolean }> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const userAgent = headerList.get("user-agent") ?? undefined;
  return { mode: modeFor(userAgent, cookieStore.get(MODE_COOKIE)?.value), switchable: userAgentFromString(userAgent).device.type !== "mobile" };
}
