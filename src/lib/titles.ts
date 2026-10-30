// The Session files titles with the article last ("Lilting Banshee, The") so they sort by their real first word.
// People say "The Lilting Banshee": show that, and keep sorting by the stored form.
const TRAILING_ARTICLE = /^(.+), (The|A|An)$/;

export function displayTitle(title: string) {
  const match = TRAILING_ARTICLE.exec(title.trim());
  return match ? `${match[2]} ${match[1]}` : title;
}

/** Set names are tune titles joined with " / "; each part reads naturally. */
export function displaySetTitle(name: string) {
  return name.split(" / ").map(displayTitle).join(" / ");
}
