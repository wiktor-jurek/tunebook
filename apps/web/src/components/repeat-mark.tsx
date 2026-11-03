// The repeat sign from the Tune Companion mark (its two dots and barline), cut from the mark's own geometry.
// It marks a set: tunes played together and repeated. The orange dots and ink bar come from the brand tokens.
export function RepeatMark() {
  return <svg className="repeat-mark" viewBox="10 16 28 68" aria-hidden="true"><circle className="dot" cx="18" cy="40" r="6.5" /><circle className="dot" cx="18" cy="60" r="6.5" /><rect className="bar" x="28" y="17" width="7.5" height="66" rx="3.75" /></svg>;
}
