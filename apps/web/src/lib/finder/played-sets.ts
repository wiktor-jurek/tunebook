// Tunes played straight after one another are a set: musicians roll from one into the next with barely a pause.
// A longer stretch with no tune named (a chat, a song, a round at the bar) starts a new set.
export const SET_BREAK_MS = 20_000;

/** Splits a setlist, in playing order, into the runs of tunes played back to back. */
export function playedSets<T extends { startMs: number; endMs: number }>(tunes: T[], breakMs = SET_BREAK_MS): T[][] {
  const sets: T[][] = [];
  let edge = -Infinity;
  for (const tune of tunes) {
    if (!sets.length || tune.startMs - edge > breakMs) sets.push([]);
    sets.at(-1)!.push(tune);
    edge = Math.max(edge, tune.endMs);
  }
  return sets;
}
