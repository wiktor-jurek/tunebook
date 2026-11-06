import { describe, expect, it } from "vitest";
import { recordingType } from "@/lib/recording-types";

describe("recordingType", () => {
  it("keeps what the live recorder makes, without codecs", () => {
    expect(recordingType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(recordingType("audio/mp4")).toBe("audio/mp4");
  });
  it("maps the other names phones and browsers give the same formats", () => {
    expect(recordingType("audio/x-m4a")).toBe("audio/mp4");
    expect(recordingType("audio/mp3")).toBe("audio/mpeg");
    expect(recordingType("audio/x-wav")).toBe("audio/wav");
  });
  it("falls back to the file name when the type is empty or vague", () => {
    expect(recordingType("", "Voice 001.m4a")).toBe("audio/mp4");
    expect(recordingType("application/octet-stream", "session.MP3")).toBe("audio/mpeg");
  });
  it("refuses what is not audio it stores", () => {
    expect(recordingType("image/png", "photo.png")).toBeNull();
    expect(recordingType("", "notes")).toBeNull();
  });
});
