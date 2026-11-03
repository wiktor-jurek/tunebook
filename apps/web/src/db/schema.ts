import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import type { AbilityLevel } from "../lib/ability";

// Where a play-along is in its score: [ms into the recording, 1/48 whole notes into the score as abcjs plays it]
// anchors (ml/yue/timing.py); loop is the score's length when the recording plays the tune more than once.
export type PlayalongTiming = { anchors: [number, number][]; loop?: number };

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const catalogSettings = pgTable("catalog_settings", {
  settingId: integer("setting_id").primaryKey(),
  tuneId: integer("tune_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind"),
  meter: text("meter"),
  mode: text("mode"),
  abc: text("abc").notNull(),
  contributor: text("contributor"),
  composer: text("composer"),
  sourceUrl: text("source_url").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("catalog_title_idx").on(t.title), index("catalog_tune_idx").on(t.tuneId)]);

// Tune-level popularity from The Session: how many member tunebooks contain the tune.
export const catalogTunes = pgTable("catalog_tunes", {
  tuneId: integer("tune_id").primaryKey(),
  tunebooks: integer("tunebooks").notNull().default(0),
}, (t) => [index("catalog_tune_popularity_idx").on(t.tunebooks)]);

// Melody line of each catalog setting for Listen. Durations are in 1/48 of a whole note;
// chars are score positions of each note, so a match can be highlighted.
export const catalogMelodies = pgTable("catalog_melodies", {
  settingId: integer("setting_id").primaryKey().references(() => catalogSettings.settingId, { onDelete: "cascade" }),
  tuneId: integer("tune_id").notNull(),
  pitches: smallint("pitches").array().notNull(),
  durations: smallint("durations").array().notNull(),
  chars: integer("chars").array().notNull(),
  version: text("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Generated play-along recordings of a catalog setting, stored in the private B2 bucket.
export const playalongTracks = pgTable("playalong_tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  settingId: integer("setting_id").notNull().references(() => catalogSettings.settingId, { onDelete: "cascade" }),
  tuneId: integer("tune_id").notNull(),
  label: text("label").notNull(),
  bpm: smallint("bpm"),
  durationMs: integer("duration_ms").notNull(),
  storageKey: text("storage_key").notNull(),
  model: text("model").notNull(),
  timing: jsonb("timing").$type<PlayalongTiming>(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("playalong_storage_key_idx").on(t.storageKey), index("playalong_setting_idx").on(t.settingId)]);

export const savedTunes = pgTable("saved_tunes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  settingId: integer("setting_id").notNull(),
  tuneId: integer("tune_id").notNull(),
  title: text("title").notNull(),
  emojiOverride: text("emoji_override"),
  kind: text("kind"),
  meter: text("meter"),
  mode: text("mode"),
  abc: text("abc").notNull(),
  contributor: text("contributor"),
  composer: text("composer"),
  sourceUrl: text("source_url").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("saved_user_setting_idx").on(t.userId, t.settingId), index("saved_user_title_idx").on(t.userId, t.title)]);

export const tuneEmojiSuggestions = pgTable("tune_emoji_suggestions", {
  tuneId: integer("tune_id").primaryKey(),
  emoji: text("emoji").notNull(),
  matcherVersion: text("matcher_version").notNull(),
  createdAt: createdAt(),
});

export const tunePractice = pgTable("tune_practice", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  tuneId: integer("tune_id").notNull(),
  playableTempo: integer("playable_tempo"),
  levelOverride: text("level_override").$type<AbilityLevel>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.tuneId] }),
  check("practice_tempo_range", sql`${t.playableTempo} IS NULL OR ${t.playableTempo} BETWEEN 50 AND 150`),
  check("practice_level_values", sql`${t.levelOverride} IS NULL OR ${t.levelOverride} IN ('unlearned', 'learning', 'learned', 'mastered')`),
]);

export const folders = pgTable("folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  createdAt: createdAt(),
}, (t) => [index("folder_parent_idx").on(t.userId, t.parentId)]);

export const tunebooks = pgTable("tunebooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id"),
  name: text("name").notNull(),
  emoji: text("emoji"),
  linkVisible: boolean("link_visible").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("book_folder_idx").on(t.userId, t.folderId)]);

export const bookShares = pgTable("book_shares", {
  bookId: uuid("book_id").notNull().references(() => tunebooks.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.bookId, t.email] }), index("book_share_email_idx").on(t.email)]);

// Session repertoire, shared by every viewer of a book and all settings of a tune.
export const bookPopularTunes = pgTable("book_popular_tunes", {
  bookId: uuid("book_id").notNull().references(() => tunebooks.id, { onDelete: "cascade" }),
  tuneId: integer("tune_id").notNull(),
}, (t) => [primaryKey({ columns: [t.bookId, t.tuneId] })]);

export const tuneSets = pgTable("tune_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  autoName: boolean("auto_name").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("set_user_idx").on(t.userId)]);

export const setTunes = pgTable("set_tunes", {
  setId: uuid("set_id").notNull().references(() => tuneSets.id, { onDelete: "cascade" }),
  tuneId: uuid("tune_id").notNull().references(() => savedTunes.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (t) => [primaryKey({ columns: [t.setId, t.tuneId] }), index("set_tune_order_idx").on(t.setId, t.position), index("set_tune_membership_idx").on(t.tuneId), check("set_position_nonnegative", sql`${t.position} >= 0`)]);

// Keep the existing table and migrate its individual tunes into ordered entries. A set lives in one tunebook, the
// session it is played at, so a set appears in at most one entry; the same tunes elsewhere are a separate set.
export const bookEntries = pgTable("book_tunes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => tunebooks.id, { onDelete: "cascade" }),
  tuneId: uuid("tune_id").references(() => savedTunes.id, { onDelete: "cascade" }),
  setId: uuid("set_id").references(() => tuneSets.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (t) => [index("book_tune_order_idx").on(t.bookId, t.position), uniqueIndex("book_set_idx").on(t.setId), check("position_nonnegative", sql`${t.position} >= 0`), check("book_entry_one_kind", sql`(${t.tuneId} IS NULL) <> (${t.setId} IS NULL)`)]);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  defaultSound: integer("default_sound").notNull().default(74),
});

// A session recorded on a phone in session mode, uploaded to the private B2 bucket when it stops.
// uploadedAt stays null until the upload finishes, so half-uploaded recordings never list.
export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  storageKey: text("storage_key").notNull(),
  mime: text("mime").notNull(),
  durationMs: integer("duration_ms").notNull().default(0),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("recording_storage_key_idx").on(t.storageKey), index("recording_user_idx").on(t.userId, t.recordedAt)]);

// The setlist of a recording: each tune the finder named, and where it starts and ends. A tune the person said was wrong
// (swiped away live, or removed later) stays, marked rejected and hidden: it is a labelled mistake for training the finder.
export const recordingTunes = pgTable("recording_tunes", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
  tuneId: integer("tune_id").notNull(),
  settingId: integer("setting_id").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  rejected: boolean("rejected").notNull().default(false),
}, (t) => [index("recording_tune_recording_idx").on(t.recordingId, t.startMs)]);
