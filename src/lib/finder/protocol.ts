// Messages between the Tune finder page and its worker.

export type FinderRequest =
  | { type: "init"; modelUrl: string; tunesUrl: string }
  | { type: "audio"; samples: Float32Array; rate: number }
  | { type: "reset" };

export type FinderCandidate = { tuneId: number; cosine: number };

export type FinderResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; tunes: number }
  | { type: "quiet" }
  | { type: "verdict"; status: "listening" | "unsure" | "match"; margin: number; ms: number; candidates: FinderCandidate[] }
  | { type: "error"; message: string };
