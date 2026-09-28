// Keep this schema limited to counts and fixed categories, never user-entered text or IDs.
type Outcome = "success" | "error";
type LibraryOperation = "createBook" | "createFolder" | "renameBook" | "renameFolder" | "moveBook" | "moveFolder" | "deleteBook" | "deleteFolder" | "setBookEmoji" | "addToBook" | "removeFromBook" | "deleteSavedTune";
const libraryEvents = {
  createBook: "tunebook_created", createFolder: "folder_created", renameBook: "tunebook_renamed",
  renameFolder: "folder_renamed", moveBook: "tunebook_moved", moveFolder: "folder_moved",
  deleteBook: "tunebook_deleted", deleteFolder: "folder_deleted", setBookEmoji: "tunebook_icon_changed",
  addToBook: "tune_added_to_book", removeFromBook: "tune_removed_from_book", deleteSavedTune: "tune_deleted",
} as const;
type LibraryEvent = typeof libraryEvents[LibraryOperation];
type Events = Record<LibraryEvent, { outcome: Outcome }> & {
  auth_submitted: { mode: "sign-in" | "sign-up" | "forgot" | "reset" };
  auth_completed: { mode: "sign-in" | "sign-up" | "forgot" | "reset"; outcome: Outcome };
  google_sign_in_started: Record<string, never>;
  google_sign_in_failed: Record<string, never>;
  signed_out: { outcome: Outcome };
  tune_lookup: { source: "url" | "title"; outcome: Outcome; result_count?: number };
  tune_saved: { outcome: Outcome };
  tune_icon_changed: { outcome: Outcome; source: "suggested" | "custom" };
  set_created: { outcome: Outcome; tune_count: number };
  set_updated: { outcome: Outcome; tune_count: number; book_count: number };
  set_deleted: { outcome: Outcome; book_count: number };
  set_added_to_book: { outcome: Outcome };
  book_entry_changed: { outcome: Outcome; kind: "tune" | "set"; action: "up" | "down" | "ungroup" | "remove" };
  set_tune_reordered: { outcome: Outcome; direction: "up" | "down" };
  share_dialog_opened: Record<string, never>;
  book_shared_by_email: { outcome: Outcome; delivery?: "sent" | "warning" };
  book_share_removed: { outcome: Outcome };
  book_visibility_changed: { outcome: Outcome; visibility: "public" | "restricted" };
  book_link_copied: { outcome: Outcome };
  shared_tune_saved: { outcome: Outcome };
  shared_book_saved: { outcome: Outcome };
  tunebook_opened: { access: "owner" | "viewer"; signed_in: boolean; tune_count: number; set_count: number };
  guest_save_sign_in: { kind: "tune" | "book" };
  playback_started: { instrument: number; tempo: number };
  playback_paused: Record<string, never>;
  playback_completed: Record<string, never>;
  playback_failed: Record<string, never>;
  playback_restarted: Record<string, never>;
  playback_sound_changed: { instrument: number };
  playback_tempo_changed: { tempo: number };
  playback_seeked: Record<string, never>;
  notation_opened: Record<string, never>;
  tune_source_opened: Record<string, never>;
  scores_toggled: { action: "expand" | "collapse"; scope: "tune" | "all" };
  contents_navigated: { kind: "tune" | "set" };
  print_requested: Record<string, never>;
  preferences_saved: { outcome: Outcome; instrument: number };
};
type Payload = Record<string, unknown>;
type Tracker = { track: (payload: (defaults: Payload) => Payload) => Promise<unknown> | void };
declare global { interface Window { umami?: Tracker } }

export function analyticsPath(value: string): string {
  const path = value.split(/[?#]/)[0];
  if (/^\/books\/[^/]+\/?$/.test(path)) return "/books/:id";
  if (/^\/tunes\/[^/]+\/?$/.test(path)) return "/tunes/:id";
  return ["/", "/sets", "/sign-in", "/sign-up", "/forgot-password", "/reset-password"].includes(path) ? path : "/other";
}

function enabled() {
  return typeof window !== "undefined" && ["libresession.com", "www.libresession.com"].includes(window.location.hostname)
    && navigator.doNotTrack !== "1" && navigator.doNotTrack !== "yes";
}

function context(path: string): Payload {
  let referrer = "";
  try {
    const source = new URL(document.referrer);
    referrer = source.origin === window.location.origin ? analyticsPath(source.pathname) : source.origin;
  } catch { /* Direct visits have no referrer. */ }
  return { url: path, title: path, referrer };
}

const pending: Payload[] = [];
function send(payload: Payload) {
  try {
    const result = window.umami?.track((defaults) => ({ ...defaults, ...payload }));
    if (result) void result.catch(() => {});
  } catch { /* Analytics must never interrupt the app. */ }
}

export function trackEvent<Name extends keyof Events>(name: Name, data: Events[Name]) {
  if (!enabled()) return;
  const payload = { ...context(analyticsPath(window.location.pathname)), name, data };
  if (window.umami) send(payload);
  else if (pending.length < 50) pending.push(payload);
}

export function trackPageView(pathname: string) {
  if (!enabled() || !window.umami) return;
  send(context(analyticsPath(pathname)));
  for (const payload of pending.splice(0)) send(payload);
}

export function trackLibraryAction(operation: LibraryOperation, outcome: Outcome) {
  trackEvent(libraryEvents[operation], { outcome });
}
