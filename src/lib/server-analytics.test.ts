import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let analytics: typeof import("./server-analytics");
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("BETTER_AUTH_URL", "https://libresession.com");
  fetchMock = vi.fn(async () => Response.json({ cache: "token" }));
  vi.stubGlobal("fetch", fetchMock);
  analytics = await import("./server-analytics");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url, headers: init.headers, body: JSON.parse(init.body) }));

describe("server analytics", () => {
  it("sends events with the account as Umami's distinct ID and the visitor's agent and IP", async () => {
    const request = new Request("https://libresession.com/api/mcp", { headers: { "user-agent": "claude-code/2.1", "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    analytics.trackServer("mcp_tool_called", { tool: "search_catalog", query: "kesh", empty: "", missing: undefined, result_count: 3 }, { userId: "user-1", request, url: "/mcp/search_catalog" });
    await analytics.flushServerAnalytics();
    expect(sent()).toEqual([{
      url: "https://analytics.jurek.dev/api/send",
      headers: { "Content-Type": "application/json", "User-Agent": "claude-code/2.1", "X-Forwarded-For": "203.0.113.9" },
      body: { type: "event", payload: expect.objectContaining({
        website: "48e712da-7618-450e-8c2f-88ba9f613eb7", hostname: "libresession.com", url: "/mcp/search_catalog", id: "user-1",
        name: "mcp_tool_called", data: { tool: "search_catalog", query: "kesh", result_count: 3 },
      }) },
    }]);
  });

  it("identifies users with profile data and a fallback agent outside requests", async () => {
    analytics.identifyServer("user-1", { name: "Ana", email: "ana@example.com" });
    await analytics.flushServerAnalytics();
    const [call] = sent();
    expect(call.headers["User-Agent"]).toBe(analytics.SERVER_AGENT);
    expect(call.body).toEqual({ type: "identify", payload: expect.objectContaining({ id: "user-1", data: { name: "Ana", email: "ana@example.com" } }) });
  });

  it("sends as Tune Companion instead of forwarding automated agents when asked", async () => {
    const request = new Request("https://libresession.com/api/mcp", { headers: { "user-agent": "claude-code/2.1" } });
    analytics.trackServer("mcp_tool_called", {}, { request, serverAgent: true });
    await analytics.flushServerAnalytics();
    expect(sent()[0].headers["User-Agent"]).toBe("TuneCompanion/1.0 (Linux x86_64)");
  });

  it("bounds long strings", () => {
    expect(analytics.cleanData({ text: "x".repeat(900) }).text).toHaveLength(500);
  });

  it("never throws or blocks when Umami fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() => analytics.trackServer("user_signed_in", { method: "email" })).not.toThrow();
    await expect(analytics.flushServerAnalytics()).resolves.toBeUndefined();
  });

  it("stays silent outside production and when disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    analytics.trackServer("user_signed_in", {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UMAMI_DISABLED", "true");
    analytics.trackServer("user_signed_in", {});
    await analytics.flushServerAnalytics();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
