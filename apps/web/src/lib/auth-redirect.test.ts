import { expect, it } from "vitest";
import { authReturnPath } from "./auth-redirect";

it("returns to a shared book while rejecting external or malformed redirects", () => {
  const path = "/books/12345678-1234-1234-1234-123456789012";
  expect(authReturnPath(path)).toBe(path);
  for (const input of [undefined, [path], "https://example.com", "//example.com", "/\\example.com", `${path}?next=//example.com`, "/books/invalid"]) {
    expect(authReturnPath(input)).toBe("/");
  }
});
