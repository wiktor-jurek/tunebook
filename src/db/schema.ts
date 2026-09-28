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
  kind: text("kind"),
  meter: text("meter"),
  mode: text("mode"),
  abc: text("abc").notNull(),
  contributor: text("contributor"),
  composer: text("composer"),
  sourceUrl: text("source_url").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("saved_user_setting_idx").on(t.userId, t.settingId), index("saved_user_title_idx").on(t.userId, t.title)]);

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

export const bookTunes = pgTable("book_tunes", {
  bookId: uuid("book_id").notNull().references(() => tunebooks.id, { onDelete: "cascade" }),
  tuneId: uuid("tune_id").notNull().references(() => savedTunes.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (t) => [primaryKey({ columns: [t.bookId, t.tuneId] }), index("book_tune_order_idx").on(t.bookId, t.position), check("position_nonnegative", sql`${t.position} >= 0`)]);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  defaultSound: integer("default_sound").notNull().default(74),
});
