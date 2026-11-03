export function defaultSetName(tunes: { title: string }[]): string {
  return tunes.map((tune) => tune.title).join(" / ");
}

export function displaySetName(set: { name: string; autoName: boolean }, tunes: { title: string }[]): string {
  return set.autoName ? defaultSetName(tunes) || "Untitled set" : set.name;
}
