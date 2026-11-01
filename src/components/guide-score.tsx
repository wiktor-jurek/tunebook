"use client";

import { useState } from "react";
import { ChevronDown, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpeningPhrase } from "@/components/opening-phrase";
import { Score } from "@/components/score";
import { resolvePractice } from "@/lib/ability";
import { trackEvent } from "@/lib/analytics";
import type { TuneWithPractice } from "@/lib/tune-practice";

type Tune = { tuneId: number; settingId: number; title: string; kind: string; meter: string; mode: string; abc: string; sourceUrl: string };

/** A guide tune's opening bars, opening out to its whole score and player for anyone, signed in or not. */
export function GuideScore({ tune }: { tune: Tune }) {
  const [open, setOpen] = useState(false);
  // The score expects a saved tune; a guide's tune is nobody's, so it has no practice or icon to edit.
  const full = { ...tune, id: `guide-${tune.settingId}`, userId: "", contributor: null, composer: null, emojiOverride: null, emoji: "", suggestedEmoji: "",
    createdAt: new Date(0), practice: resolvePractice() } as unknown as TuneWithPractice;
  return <div className="guide-score">
    {open ? <Score tune={full} showTitle={false} showPractice={false} practiceEditable={false} /> : <OpeningPhrase tune={tune} />}
    <Button variant="ghost" size="sm" className="guide-score-toggle" aria-expanded={open} onClick={() => { if (!open) trackEvent("guide_score_opened", {}); setOpen(!open); }}>
      {open ? <><ChevronDown size={15} className="is-flipped" /> Opening bars only</> : <><Music size={15} /> Whole tune and play along</>}
    </Button>
  </div>;
}
