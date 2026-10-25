// Browser events for Umami. Signed-in visitors are identified by account ID (see identifyUser), and events may
// carry tune, book and set names and search text. URLs stay grouped so IDs and tokens never reach the tracker.
type Outcome = "success" | "error";
type LibraryOperation = "createBook" | "createFolder" | "renameBook" | "renameFolder" | "moveBook" | "moveFolder" | "deleteBook" | "deleteFolder" | "setBookEmoji" | "addToBook" | "removeFromBook" | "deleteSavedTune";
const libraryEvents = {
  createBook: "tunebook_created", createFolder: "folder_created", renameBook: "tunebook_renamed",
  renameFolder: "folder_renamed", moveBook: "tunebook_moved", moveFolder: "folder_moved",
  deleteBook: "tunebook_deleted", deleteFolder: "folder_deleted", setBookEmoji: "tunebook_icon_changed",
  addToBook: "tune_added_to_book", removeFromBook: "tune_removed_from_book", deleteSavedTune: "tune_deleted",
} as const;
type LibraryEvent = typeof libraryEvents[LibraryOperation];
type Names = { name?: string; book?: string; tune?: string };
type Events = Record<LibraryEvent, { outcome: Outcome } & Names> & {
  auth_submitted: { mode: "sign-in" | "sign-up" | "forgot" | "reset" };
  auth_completed: { mode: "sign-in" | "sign-up" | "forgot" | "reset"; outcome: Outcome };
  google_sign_in_started: Record<string, never>;
  google_sign_in_failed: Record<string, never>;
  signed_out: { outcome: Outcome };
  tune_lookup: { source: "url" | "title"; outcome: Outcome; result_count?: number; query: string };
  tune_saved: { outcome: Outcome; tune?: string };
  tune_icon_changed: { outcome: Outcome; source: "suggested" | "custom" };
  tune_practice_updated: { outcome: Outcome; source: "tempo" | "level" | "reset" };
  set_created: { outcome: Outcome; tune_count: number; name?: string };
  set_updated: { outcome: Outcome; tune_count: number; book_count: number; name?: string };
  set_deleted: { outcome: Outcome; book_count: number; name?: string };
  set_added_to_book: { outcome: Outcome; name?: string };
  book_entry_changed: { outcome: Outcome; kind: "tune" | "set"; action: "up" | "down" | "ungroup" | "remove" };
  set_tune_reordered: { outcome: Outcome; direction: "up" | "down" };
  share_dialog_opened: Record<string, never>;
  book_shared_by_email: { outcome: Outcome; delivery?: "sent" | "warning" };
  book_share_removed: { outcome: Outcome };
  book_visibility_changed: { outcome: Outcome; visibility: "public" | "restricted" };
  book_link_copied: { outcome: Outcome };
  shared_tune_saved: { outcome: Outcome };
  shared_book_saved: { outcome: Outcome };
  tunebook_opened: { access: "owner" | "viewer"; signed_in: boolean; tune_count: number; set_count: number; book: string };
  guest_save_sign_in: { kind: "tune" | "book" };
  playback_started: { instrument: number; tempo: number; tune: string };
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
type Tracker = {
  track: (payload: (defaults: Payload) => Payload) => Promise<unknown> | void;
  identify: (id: string, data?: Payload) => Promise<unknown> | void;
};
export type Identity = { id: string; name: string; email: string };
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
let identity: Identity | null = null;
let identified = false;

// Umami attaches the distinct ID to every later event, so identify before sending anything queued.
function applyIdentity() {
  if (!identity || identified || !window.umami) return;
  identified = true;
  try {
    const result = window.umami.identify(identity.id, { name: identity.name, email: identity.email });
    if (result) void result.catch(() => {});
  } catch { /* Analytics must never interrupt the app. */ }
}

export function identifyUser(user: Identity) {
  if (!enabled() || identity?.id === user.id) return;
  identity = user; identified = false;
  applyIdentity();
}
function send(payload: Payload) {
  try {
    const result = window.umami?.track((defaults) => ({ ...defaults, ...payload }));
    if (result) void result.catch(() => {});
  } catch { /* Analytics must never interrupt the app. */ }
}

export function trackEvent<Name extends keyof Events>(name: Name, data: Events[Name]) {
  if (!enabled()) return;
  const payload = { ...context(analyticsPath(window.location.pathname)), name, data };
  applyIdentity();
  if (window.umami) send(payload);
  else if (pending.length < 50) pending.push(payload);
}

export function trackPageView(pathname: string) {
  if (!enabled() || !window.umami) return;
  applyIdentity();
  send(context(analyticsPath(pathname)));
  for (const payload of pending.splice(0)) send(payload);
}

export function trackLibraryAction(operation: LibraryOperation, outcome: Outcome, names: Names = {}) {
  trackEvent(libraryEvents[operation], { outcome, ...names });
}
