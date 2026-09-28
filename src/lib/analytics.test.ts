import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";

let analytics: typeof import("./analytics");
let track: Mock<(build: (defaults: Record<string, unknown>) => Record<string, unknown>) => Promise<void>>;
let location: { hostname: string; origin: string; pathname: string };
let payloads: Record<string, unknown>[];

beforeEach(async () => {
  vi.resetModules();
  payloads = [];
  location = { hostname: "libresession.com", origin: "https://libresession.com", pathname: "/books/private-book" };
  track = vi.fn((build: (defaults: Record<string, unknown>) => Record<string, unknown>) => {
    payloads.push(build({ website: "website-id", url: "/reset-password?token=secret", title: "Private book title", referrer: "https://example.com/?email=private" }));
    return Promise.resolve();
  });
  vi.stubGlobal("window", { location, umami: { track } });
  vi.stubGlobal("document", { referrer: "https://libresession.com/reset-password?token=secret" });
  vi.stubGlobal("navigator", { doNotTrack: "0" });
  analytics = await import("./analytics");
});
afterEach(() => vi.unstubAllGlobals());

describe("analytics privacy and delivery", () => {
  it("groups book and tune routes without exposing IDs, query strings, or hashes", () => {
    expect(analytics.analyticsPath("/books/private-id?email=private#secret")).toBe("/books/:id");
    expect(analytics.analyticsPath("/tunes/private-id/")).toBe("/tunes/:id");
    expect(analytics.analyticsPath("/reset-password?token=secret")).toBe("/reset-password");
    expect(analytics.analyticsPath("/unknown/private-token")).toBe("/other");
  });

  it("overrides sensitive tracker defaults for pageviews and events", () => {
    analytics.trackPageView("/reset-password?token=secret");
    analytics.trackEvent("book_shared_by_email", { outcome: "success", delivery: "sent" });
    expect(payloads).toEqual([
      { website: "website-id", url: "/reset-password", title: "/reset-password", referrer: "/reset-password" },
      { website: "website-id", url: "/books/:id", title: "/books/:id", referrer: "/reset-password", name: "book_shared_by_email", data: { outcome: "success", delivery: "sent" } },
    ]);
    expect(JSON.stringify(payloads)).not.toMatch(/secret|private|email=/);
  });

  it("keeps only the origin of external referrers", () => {
    vi.stubGlobal("document", { referrer: "https://example.com/private?email=user@example.com" });
    analytics.trackPageView("/");
    expect(payloads[0].referrer).toBe("https://example.com");
  });

  it("handles empty or malformed referrers", () => {
    vi.stubGlobal("document", { referrer: "not a url" });
    analytics.trackPageView("/");
    expect(payloads[0].referrer).toBe("");
  });

  it.each(["localhost", "127.0.0.1", "preview.libresession.com", "libresession.com.example.com"])("does not track on %s", (hostname) => {
    location.hostname = hostname;
    analytics.trackPageView("/");
    analytics.trackEvent("print_requested", {});
    expect(track).not.toHaveBeenCalled();
  });

  it("allows the www production domain", () => {
    location.hostname = "www.libresession.com";
    analytics.trackEvent("print_requested", {});
    expect(track).toHaveBeenCalledTimes(1);
  });

  it.each(["1", "yes"])("honors Do Not Track value %s", (doNotTrack) => {
    vi.stubGlobal("navigator", { doNotTrack });
    analytics.trackPageView("/");
    analytics.trackEvent("print_requested", {});
    expect(track).not.toHaveBeenCalled();
  });

  it("is safe during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(() => analytics.trackEvent("print_requested", {})).not.toThrow();
    expect(() => analytics.trackPageView("/")).not.toThrow();
  });

  it("queues early events with their original route and flushes once", () => {
    window.umami = undefined;
    analytics.trackEvent("guest_save_sign_in", { kind: "book" });
    location.pathname = "/sign-in";
    window.umami = { track };
    analytics.trackPageView("/sign-in?next=private");
    analytics.trackPageView("/sign-up");
    expect(payloads.map((payload) => [payload.url, payload.name])).toEqual([
      ["/sign-in", undefined], ["/books/:id", "guest_save_sign_in"], ["/sign-up", undefined],
    ]);
  });

  it("bounds the queue when a tracker is blocked", () => {
    window.umami = undefined;
    for (let count = 0; count < 80; count++) analytics.trackEvent("print_requested", {});
    window.umami = { track };
    analytics.trackPageView("/");
    expect(track).toHaveBeenCalledTimes(51);
  });

  it("isolates both synchronous and asynchronous tracker failures", async () => {
    track.mockImplementationOnce(() => { throw new Error("blocked"); });
    expect(() => analytics.trackEvent("print_requested", {})).not.toThrow();
    track.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    expect(() => analytics.trackPageView("/")).not.toThrow();
    await Promise.resolve();
  });

  it("records successful and failed library operations as separate outcomes", () => {
    analytics.trackLibraryAction("createBook", "success");
    analytics.trackLibraryAction("createBook", "error");
    expect(payloads.map((payload) => [payload.name, payload.data])).toEqual([
      ["tunebook_created", { outcome: "success" }], ["tunebook_created", { outcome: "error" }],
    ]);
  });
});
