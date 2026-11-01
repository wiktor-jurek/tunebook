import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const request = (url: string) => new NextRequest(url, { headers: { host: new URL(url).host } });
afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  it("sends the old domain and www to tunecompanion.com, keeping the path and query", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://tunecompanion.com");
    for (const from of ["https://libresession.com/books/abc?view=reader", "https://www.libresession.com/books/abc?view=reader", "https://www.tunecompanion.com/books/abc?view=reader"]) {
      const response = proxy(request(from));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("https://tunecompanion.com/books/abc?view=reader");
    }
  });
  it("leaves the canonical host, other hosts and the pre-switch setup alone", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://tunecompanion.com");
    expect(proxy(request("https://tunecompanion.com/")).headers.get("location")).toBeNull();
    expect(proxy(request("http://localhost:3000/")).headers.get("location")).toBeNull();
    vi.stubEnv("BETTER_AUTH_URL", "https://libresession.com");
    expect(proxy(request("https://libresession.com/")).headers.get("location")).toBeNull();
  });
});
