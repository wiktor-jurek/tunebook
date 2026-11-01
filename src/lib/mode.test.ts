import { describe, expect, it } from "vitest";
import { modeFor } from "@/lib/mode";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

describe("modeFor", () => {
  it("gives phones the session layout", () => {
    expect(modeFor(IPHONE)).toBe("session");
    expect(modeFor(ANDROID)).toBe("session");
  });
  it("gives desktops and tablets the full app", () => {
    expect(modeFor(MAC)).toBe("practice");
    expect(modeFor(IPAD)).toBe("practice");
    expect(modeFor(undefined)).toBe("practice");
  });
});
