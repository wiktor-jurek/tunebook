// The credits, said once per page rather than under every score: where the tunes come from and how the play-alongs are made.
export function SiteCredits() {
  return <p className="site-credits">
    Tunes from <a href="https://thesession.org" target="_blank" rel="noreferrer">The Session</a> and its contributors, under the{" "}
    <a href="https://github.com/adactio/TheSession-data/blob/main/LICENSE.md" target="_blank" rel="noreferrer">Open Database License</a>.
    Play-along recordings are generated with <a href="https://huggingface.co/m-a-p/YuE2-3B" target="_blank" rel="noreferrer">YuE2</a>.
  </p>;
}

export function SiteFooter() {
  return <footer className="site-footer"><SiteCredits /></footer>;
}
