import { describe, expect, it } from "vitest";
import fixture from "@/lib/finder/features.fixture.json";
import { FRAMES, SAMPLE_RATE, WINDOW_SAMPLES, keyShift, windowFeatures } from "@/lib/finder/features";
import { Decoder, topK } from "@/lib/finder/decode";
import { resample } from "@/lib/finder/resample";

// The same 8 s as test_signal() in ml/train/export_finder.py, which wrote the fixture from tunebook_ml/pitchclass.py.
function testSignal() {
  const notes = [62, 66, 69, 74, 73, 71, 69, 66, 67, 71, 74, 78, 76, 74, 73, 71];
  const out = new Float32Array(WINDOW_SAMPLES);
  for (let n = 0; n < WINDOW_SAMPLES; n++) {
    const t = n / SAMPLE_RATE;
    let signal = 0.3 * Math.sin(2 * Math.PI * 98 * t);
    for (let i = 0; i < 40; i++) {
      const local = t - i * 0.2;
      if (local < 0 || local >= 0.2) continue;
      const freq = 440 * 2 ** ((notes[i % notes.length] - 69) / 12), envelope = Math.min(1, local / 0.01) * Math.exp(-3 * local);
      for (let h = 1; h <= 4; h++) signal += (envelope * Math.sin(2 * Math.PI * freq * h * t)) / h;
    }
    out[n] = 0.2 * signal;
  }
  return out;
}

describe("tune finder features", () => {
  it("match the Python front end", () => {
    const features = windowFeatures(testSignal());
    let worst = 0;
    for (let k = 0; k < 12; k++) for (let t = 0; t < FRAMES; t++) worst = Math.max(worst, Math.abs(features[k * FRAMES + t] - fixture.features[k][t]));
    expect(worst).toBeLessThan(2e-3);
  });

  it("rotate to the same key as Python", () => {
    // Undo the fixture's rotation and check the shift is found again.
    const canon = Float32Array.from(fixture.features.flat());
    const raw = new Float32Array(12 * FRAMES);
    for (let k = 0; k < 12; k++) raw.set(canon.subarray(k * FRAMES, (k + 1) * FRAMES), ((k + fixture.shift) % 12) * FRAMES);
    expect(keyShift(raw)).toBe(fixture.shift);
  });

  it("resample a tone without moving it", () => {
    const rate = 48000, input = Float32Array.from({ length: rate }, (_, n) => Math.sin((2 * Math.PI * 440 * n) / rate));
    const out = resample(input, rate);
    expect(out.length).toBe(SAMPLE_RATE);
    let error = 0;
    for (let n = 100; n < out.length - 100; n++) error = Math.max(error, Math.abs(out[n] - Math.sin((2 * Math.PI * 440 * n) / SAMPLE_RATE)));
    expect(error).toBeLessThan(0.01);
  });
});

describe("tune finder decoder", () => {
  it("ranks the highest cosines first", () => {
    expect(topK(Float32Array.from([0.1, 0.5, 0.3, 0.9, 0.2]), 3).map((c) => c.index)).toEqual([3, 1, 2]);
  });

  it("answers only once a clear leader has held", () => {
    const decoder = new Decoder();
    const window = Float32Array.from([0.1, 0.4, 0.2]);
    expect(decoder.push(window).status).toBe("listening");
    expect(decoder.push(window).status).toBe("listening");
    expect(decoder.push(window)).toMatchObject({ status: "match", candidates: [{ index: 1 }, { index: 2 }, { index: 0 }] });
    expect(decoder.push(Float32Array.from([0.3, 0.31, 0.3])).status).toBe("match");
    decoder.reset();
    expect(decoder.push(window).status).toBe("listening");
  });

  it("keeps each window even when the caller reuses its buffer", () => {
    const decoder = new Decoder(), buffer = new Float32Array(3);
    for (let i = 0; i < 3; i++) { buffer.set([0.1, 0.5, 0.2]); decoder.push(buffer); }
    buffer.set([0.6, 0.0, 0.2]);
    // Three windows for tune 1 and one for tune 0: tune 1 still leads on the mean.
    expect(decoder.push(buffer).candidates[0].index).toBe(1);
  });
});
