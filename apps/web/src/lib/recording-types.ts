// The audio a session can be stored as: what the live recorder makes (WebM, MP4, Ogg) and what a phone's own recorder
// or a downloaded file usually is. Browsers and phones name the same format several ways; each maps to one type here.

export const RECORDING_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/flac": "flac", "audio/aac": "aac",
};

const ALIASES: Record<string, string> = {
  "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "video/mp4": "audio/mp4", "audio/mp3": "audio/mpeg", "audio/x-mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav", "audio/x-flac": "audio/flac", "audio/x-aac": "audio/aac",
  "audio/aacp": "audio/aac", "video/webm": "audio/webm", "application/ogg": "audio/ogg",
};
const BY_EXTENSION: Record<string, string> = { ...Object.fromEntries(Object.entries(RECORDING_EXTENSIONS).map(([type, ext]) => [ext, type])), mp4: "audio/mp4", oga: "audio/ogg", opus: "audio/ogg" };

/** One of RECORDING_EXTENSIONS' types for a MIME type (codecs dropped) or, when that is empty or unknown, a file name; null if neither is audio we store. */
export function recordingType(mime: string, fileName = ""): string | null {
  const base = mime.split(";")[0].trim().toLowerCase();
  const type = ALIASES[base] ?? base;
  if (RECORDING_EXTENSIONS[type]) return type;
  return BY_EXTENSION[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** For a file picker's accept attribute. */
export const RECORDING_ACCEPT = ["audio/*", ...Object.keys(BY_EXTENSION).map((ext) => `.${ext}`)].join(",");
