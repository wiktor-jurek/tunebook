// Messages between the Tune finder page and its worker.

export type FinderRequest =
  | { type: "init"; modelUrl: string; tunesUrl: string }
  | { type: "audio"; samples: Float32Array; rate: number }
  | { type: "reset" }
  // A whole recording at once, for the Sessions screen's upload: scored as the live finder would have heard it.
  | { type: "file"; samples: Float32Array; rate: number };

export type FinderCandidate = { tuneId: number; cosine: number };

export type FinderResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; tunes: number }
  | { type: "quiet" }
  | { type: "verdict"; status: "listening" | "unsure" | "match"; margin: number; ms: number; candidates: FinderCandidate[] }
  | { type: "error"; message: string }
  | { type: "fileProgress"; done: number; total: number }
  // Each tune the file's listen named, with how far into the recording (ms) it was named.
  | { type: "fileDone"; named: { tuneId: number; atMs: number }[] };
