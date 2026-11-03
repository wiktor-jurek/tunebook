"use client";

import { useEffect, useRef } from "react";
import abcjs from "abcjs";
import { openingPhrase } from "@/lib/notation";

type Tune = { title: string; kind: string | null; meter: string | null; mode: string | null; abc: string };

/** How a tune starts, as one line of music: its pickup and first two bars. */
export function OpeningPhrase({ tune, className = "" }: { tune: Tune; className?: string }) {
  const paper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paper.current) abcjs.renderAbc(paper.current, openingPhrase(tune), { responsive: "resize", add_classes: true, staffwidth: 360, paddingtop: 0, paddingbottom: 0, paddingleft: 0, paddingright: 0 });
  }, [tune]);
  return <div ref={paper} className={`opening-phrase ${className}`} aria-label={`Opening bars of ${tune.title}`} role="img" />;
}
