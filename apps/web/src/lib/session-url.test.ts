import { describe, expect, it } from "vitest";
import { parseSessionUrl } from "./session-url";

describe("The Session URL parser", () => {
  it("selects a tune or a specific setting", () => {
    expect(parseSessionUrl("https://thesession.org/tunes/123")).toEqual({ tuneId: 123, settingId: undefined });
    expect(parseSessionUrl("https://www.thesession.org/tunes/123#setting456")).toEqual({ tuneId: 123, settingId: 456 });
  });
  it("rejects other origins and paths", () => {
    expect(parseSessionUrl("https://thesession.org.evil.test/tunes/123")).toBeNull();
    expect(parseSessionUrl("http://thesession.org/tunes/123")).toBeNull();
    expect(parseSessionUrl("https://thesession.org/sets/123")).toBeNull();
  });
});
