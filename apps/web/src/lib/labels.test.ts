import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, pool: {} }));
vi.mock("@/lib/library", () => ({ searchCatalogTunes: vi.fn() }));
const { LabelError, planSave } = await import("@/lib/labels");

const tags = { instruments: [], ensemble: null, setting: null };
const clip = { startS: 30, endS: 45, tuneId: 27, setId: null, meta: null, video: "abc" };

describe("planSave", () => {
  it("keeps a single checked clip as it is, rounded to tenths", () => {
    const [row] = planSave("youtube", [clip], { segments: [{ startS: 31.234, endS: 44.96, tuneId: 27 }], verdict: "yes", tags, notes: "" });
    expect(row).toMatchObject({ startS: 31.2, endS: 45, tuneId: 27, setId: null, position: null });
  });

  it("needs every tune named before a clip is marked correct", () => {
    expect(() => planSave("youtube", [clip], { segments: [{ startS: 30, endS: 45, tuneId: null }], verdict: "yes", tags, notes: "" })).toThrow(LabelError);
  });

  it("keeps the old times and tunes when a clip is marked wrong", () => {
    const rows = planSave("youtube", [clip], { segments: [{ startS: 0, endS: 5, tuneId: null }], verdict: "no", tags, notes: "" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startS: 30, endS: 45, tuneId: 27 });
  });

  it("makes a YouTube clip split into two tunes a set, numbered in order", () => {
    const rows = planSave("youtube", [clip], { segments: [{ startS: 30, endS: 38, tuneId: 27 }, { startS: 38, endS: 45, tuneId: 1 }], verdict: "yes", tags, notes: "" });
    expect(rows.map((r) => [r.setId, r.position])).toEqual([["abc@30.0", 1], ["abc@30.0", 2]]);
  });

  it("keeps a session's set and each tune's description notes", () => {
    const old = [{ ...clip, setId: "v#1", meta: { described: "Kesh" } }, { ...clip, startS: 45, endS: 60, setId: "v#1", meta: { described: "Morrison's" } }];
    const rows = planSave("sessions", old, { segments: [{ startS: 30, endS: 46, tuneId: 55 }, { startS: 46, endS: 60, tuneId: 71 }], verdict: "yes", tags, notes: "" });
    expect(rows.map((r) => [r.setId, r.position, r.meta?.described])).toEqual([["v#1", 1, "Kesh"], ["v#1", 2, "Morrison's"]]);
  });

  it("refuses tunes that overlap or end before they start", () => {
    expect(() => planSave("youtube", [clip], { segments: [{ startS: 30, endS: 40, tuneId: 1 }, { startS: 35, endS: 45, tuneId: 2 }], verdict: "set", tags, notes: "" })).toThrow("overlap");
    expect(() => planSave("youtube", [clip], { segments: [{ startS: 40, endS: 30, tuneId: 1 }], verdict: "set", tags, notes: "" })).toThrow("end after");
  });
});
