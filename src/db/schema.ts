import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

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

export const tuneSets = pgTable("tune_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
}, (t) => [index("set_user_idx").on(t.userId)]);

export const setTunes = pgTable("set_tunes", {
  setId: uuid("set_id").notNull().references(() => tuneSets.id, { onDelete: "cascade" }),
  tuneId: uuid("tune_id").notNull().references(() => savedTunes.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (t) => [primaryKey({ columns: [t.setId, t.tuneId] }), index("set_tune_order_idx").on(t.setId, t.position), index("set_tune_membership_idx").on(t.tuneId), check("set_position_nonnegative", sql`${t.position} >= 0`)]);

// Keep the existing table and migrate its individual tunes into ordered entries.
export const bookEntries = pgTable("book_tunes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => tunebooks.id, { onDelete: "cascade" }),
  tuneId: uuid("tune_id").references(() => savedTunes.id, { onDelete: "cascade" }),
  setId: uuid("set_id").references(() => tuneSets.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (t) => [index("book_tune_order_idx").on(t.bookId, t.position), uniqueIndex("book_set_idx").on(t.bookId, t.setId), check("position_nonnegative", sql`${t.position} >= 0`), check("book_entry_one_kind", sql`(${t.tuneId} IS NULL) <> (${t.setId} IS NULL)`)]);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  defaultSound: integer("default_sound").notNull().default(74),
});
