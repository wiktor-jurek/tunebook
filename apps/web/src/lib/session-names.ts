// Sessions you recorded, named for when they were in the viewer's own time, as the phone apps name them: "This
// evening", "Last night", "Yesterday afternoon", "Saturday morning". The small hours count as the night before.

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const DAY_MS = 86_400_000;

/** Morning from 5, afternoon from 12, evening from 17, night from 21. */
export function partOfDay(date: Date) {
  const hour = date.getHours();
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 21 ? "evening" : "night";
}

/** The calendar day a moment belongs to, with the small hours (before 5) counted as the day before. */
function sessionDay(date: Date) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (date.getHours() < 5) day.setDate(day.getDate() - 1);
  return day;
}

export function sessionName(date: Date, now = new Date()) {
  const part = partOfDay(date);
  const day = sessionDay(date);
  const days = Math.round((sessionDay(now).getTime() - day.getTime()) / DAY_MS);
  if (days === 0) return part === "night" ? "Tonight" : `This ${part}`;
  if (days === 1) return part === "night" ? "Last night" : `Yesterday ${part}`;
  return `${WEEKDAY.format(day)} ${part}`;
}

/** The month heading a session sits under: "November", or "November 2025" from another year. */
export function sessionMonth(date: Date, now = new Date()) {
  return (date.getFullYear() === now.getFullYear() ? MONTH : MONTH_YEAR).format(date);
}
