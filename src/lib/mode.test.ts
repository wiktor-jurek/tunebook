import { describe, expect, it } from "vitest";
import { modeFor } from "@/lib/mode";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

describe("modeFor", () => {
  it("puts phones in session mode whatever the cookie says", () => {
    expect(modeFor(IPHONE, undefined)).toBe("session");
    expect(modeFor(ANDROID, "practice")).toBe("session");
  });
  it("keeps desktops and tablets in practice mode by default", () => {
    expect(modeFor(MAC, undefined)).toBe("practice");
    expect(modeFor(IPAD, undefined)).toBe("practice");
    expect(modeFor(undefined, undefined)).toBe("practice");
  });
  it("lets desktops and tablets switch to session mode", () => {
    expect(modeFor(MAC, "session")).toBe("session");
    expect(modeFor(IPAD, "session")).toBe("session");
  });
});
