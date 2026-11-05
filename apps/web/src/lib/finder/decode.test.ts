import { describe, expect, it } from "vitest";
import { Decoder, HISTORY, SWITCH_WINDOW } from "@/lib/finder/decode";

const tune = (leader: number, lead = 0.2) => Float32Array.from([0, 1, 2], (i) => (i === leader ? 0.3 + lead : 0.3));

describe("Decoder", () => {
  it("names a tune once a clear leader has held", () => {
    const decoder = new Decoder();
    expect(decoder.push(tune(1)).status).toBe("listening");
    expect(decoder.push(tune(1)).status).toBe("listening");
    const verdict = decoder.push(tune(1));
    expect(verdict.status).toBe("match");
    expect(verdict.candidates[0].index).toBe(1);
  });

  it("moves on to a set's next tune within the short view, not half a minute later", () => {
    const decoder = new Decoder();
    for (let i = 0; i < HISTORY; i++) decoder.push(tune(0));
    let seconds = 0, verdict = decoder.push(tune(2));
    while (!(verdict.status === "match" && verdict.candidates[0].index === 2) && seconds < HISTORY) { verdict = decoder.push(tune(2)); seconds++; }
    expect(seconds).toBeLessThanOrEqual(SWITCH_WINDOW);
    // And it stays there: the old tune's half minute is gone from the history.
    expect(decoder.push(tune(2)).candidates[0].index).toBe(2);
  });

  it("does not switch on a few odd windows", () => {
    const decoder = new Decoder();
    for (let i = 0; i < HISTORY; i++) decoder.push(tune(0));
    for (let i = 0; i < 3; i++) decoder.push(tune(2));
    const verdict = decoder.push(tune(0));
    expect(verdict.candidates[0].index).toBe(0);
  });

  it("forgets the named tune on reset", () => {
    const decoder = new Decoder();
    for (let i = 0; i < 5; i++) decoder.push(tune(0));
    decoder.reset();
    expect(decoder.push(tune(2)).status).toBe("listening");
  });
});
