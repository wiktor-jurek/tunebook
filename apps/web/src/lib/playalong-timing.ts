import type { PlayalongTiming } from "@/db/schema";

// Timing positions are in 1/48 of a whole note, as ml/yue/timing.py writes them.
export const TIMING_UNIT = 48;

// Score position of a play-along recording at ms into it, or null during its lead-in and after the tune ends.
export function scorePosition({ anchors, loop }: PlayalongTiming, ms: number) {
  if (anchors.length < 2 || ms < anchors[0][0] || ms > anchors[anchors.length - 1][0]) return null;
  let i = 1;
  while (anchors[i][0] < ms) i++;
  const [fromMs, from] = anchors[i - 1], [toMs, to] = anchors[i];
  const position = from + (to - from) * (ms - fromMs) / (toMs - fromMs);
  if (position < 0) return null;
  return loop ? position % loop : position;
}
