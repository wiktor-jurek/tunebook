import { APP_URL } from "@/lib/mcp-config";

// Server-side Umami events for work that never runs in a browser: MCP tool calls, OAuth and sign-ins.
// Events carry the account ID as Umami's distinct ID, so they join the same person's browser sessions.
const UMAMI_HOST = (process.env.UMAMI_HOST || "https://analytics.jurek.dev").replace(/\/$/, "");
const WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || "48e712da-7618-450e-8c2f-88ba9f613eb7";
// Umami drops events whose user agent looks automated (isbot), which includes every MCP client and most
// server-style agents, so server-originated events use this agent, verified against isbot 5.
export const SERVER_AGENT = "TuneCompanion/1.0 (Linux x86_64)";

type Value = string | number | boolean | null | undefined;
export type EventData = Record<string, Value>;
// serverAgent: send as Tune Companion itself (MCP and other non-browser callers) instead of forwarding the caller's agent.
export type TrackContext = { userId?: string | null; request?: Request; url?: string; serverAgent?: boolean };

const pending = new Set<Promise<void>>();
let warnedBot = false;

function enabled() {
  return process.env.NODE_ENV === "production" && process.env.UMAMI_DISABLED !== "true";
}

// Umami stores flat key/value event data; keep strings bounded and drop empty values.
export function cleanData(data: EventData) {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === "") continue;
    clean[key] = typeof value === "string" ? value.slice(0, 500) : value;
  }
  return clean;
}

function forwardedFor(request?: Request) {
  const header = request?.headers.get("x-forwarded-for") ?? request?.headers.get("x-real-ip");
  return header?.split(",")[0]?.trim() || undefined;
}

function send(type: "event" | "identify", payload: Record<string, unknown>, context: TrackContext) {
  if (!enabled()) return;
  const ip = forwardedFor(context.request);
  const delivery = fetch(`${UMAMI_HOST}/api/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": (!context.serverAgent && context.request?.headers.get("user-agent")) || SERVER_AGENT,
      ...(ip ? { "X-Forwarded-For": ip } : {}),
    },
    body: JSON.stringify({ type, payload: {
      website: WEBSITE_ID, hostname: new URL(APP_URL).hostname, language: "en", screen: "0x0",
      url: context.url ?? "/api", title: context.url ?? "/api", ...(context.userId ? { id: context.userId } : {}), ...payload,
    } }),
    signal: AbortSignal.timeout(3000),
  }).then(async (response) => {
    // Umami answers bot-like user agents with {"beep":"boop"} and discards the event.
    const body = await response.json().catch(() => null) as { beep?: string } | null;
    if (body?.beep && !warnedBot) { warnedBot = true; console.warn("Umami ignored a server event as bot traffic"); }
  }).catch(() => { /* Analytics must never interrupt the app. */ });
  const tracked = delivery.finally(() => pending.delete(tracked));
  pending.add(tracked);
}

export function trackServer(name: string, data: EventData, context: TrackContext = {}) {
  send("event", { name, data: cleanData(data) }, context);
}

export function identifyServer(userId: string, data: EventData, context: TrackContext = {}) {
  send("identify", { data: cleanData(data) }, { ...context, userId });
}

export async function flushServerAnalytics() {
  await Promise.all([...pending]);
}
