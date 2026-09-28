declare module "@yarflam/potion-base-8m" {
  /** Local Model2Vec inference. Each result is a normalized 256-dimensional vector. */
  export function embed(texts: string | string[]): Promise<Float32Array[]>;
}
