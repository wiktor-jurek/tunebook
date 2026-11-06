import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, jsonb, pgSchema, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// The tune finder's training and evaluation data (ml/tunebook_ml/store.py writes it; /admin/data reads it).
// Audio lives in the private B2 bucket under storage_key and is never served; training works from frozen
// datasets, never from these tables live.
export const ml = pgSchema("ml");

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// youtube_video: a benchmark clip's video (its opening minutes or whole recording); youtube_full: a whole pub session;
// soundcloud_full: a whole pub session from SoundCloud, used with its uploader's permission (ml/eval/soundcloud.py).
export const SOURCE_KINDS = ["youtube_video", "youtube_full", "soundcloud_full", "album", "yue", "app_recording"] as const;

// One recording: a YouTube clip or whole video, an album track section, a YuE2 performance.
export const mlSources = ml.table("sources", {
  id: serial("id").primaryKey(),
  kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
  externalId: text("external_id").notNull(), // unique per kind: the video id, "<video>.<start>-<end>" for album sections, the YuE2 name
  title: text("title"),
  channel: text("channel"),
  durationS: real("duration_s"),
  licence: text("licence"),
  meta: jsonb("meta").$type<Record<string, unknown>>(), // description, chapters, YuE2 request
  storageKey: text("storage_key"), // in the private B2 bucket; null until uploaded
  status: text("status", { enum: ["ok", "missing", "unavailable"] }).notNull().default("ok"),
  ...timestamps(),
}, (t) => [uniqueIndex("ml_source_kind_external_idx").on(t.kind, t.externalId), index("ml_source_kind_idx").on(t.kind)]);

// What a session video's description called the tune, how well that matched a catalogue title, and the other candidates.
export type SegmentMeta = { described?: string; match?: string; candidates?: number[] };

// A labelled stretch of a source: the unit everything trains or evaluates on.
export const mlSegments = ml.table("segments", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => mlSources.id, { onDelete: "cascade" }),
  startS: doublePrecision("start_s").notNull(),
  endS: doublePrecision("end_s").notNull(),
  tuneId: integer("tune_id"), // null while a set is not yet split into tunes
  settingId: integer("setting_id"),
  setId: text("set_id"),
  position: integer("position"),
  labelSource: text("label_source", { enum: ["album", "chapters", "description", "title", "human", "prelabel", "generated"] }).notNull(),
  confidence: real("confidence").notNull(),
  verified: text("verified", { enum: ["yes", "no", "set"] }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  instruments: text("instruments"),
  ensemble: text("ensemble"),
  settingTag: text("setting_tag"),
  notes: text("notes"),
  origin: text("origin").notNull(), // the file a row was imported from, or the tool that made it
  meta: jsonb("meta").$type<SegmentMeta>(),
  ...timestamps(),
}, (t) => [
  uniqueIndex("ml_segment_source_start_tune_idx").on(t.sourceId, t.startS, t.tuneId),
  index("ml_segment_tune_idx").on(t.tuneId),
  check("ml_segment_span", sql`${t.endS} > ${t.startS}`),
]);

// Which tunes' real recordings may be trained on. A tune is only ever added, never moved from eval to train.
export const mlTuneRoles = ml.table("tune_roles", {
  tuneId: integer("tune_id").primaryKey(),
  role: text("role", { enum: ["eval", "train"] }).notNull(),
  reason: text("reason").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});

// The harvester's YouTube searches, so a query is never run twice.
export const mlSearches = ml.table("searches", {
  query: text("query").primaryKey(),
  harvester: text("harvester").notNull(),
  results: integer("results").notNull(),
  searchedAt: timestamp("searched_at", { withTimezone: true }).notNull(),
});

export type DatasetCounts = { segments: number; tunes: number; seconds: number; bySource: Record<string, number> };

// A frozen dataset: the segments a run trains or evaluates on, as a manifest in B2.
export const mlDatasets = ml.table("datasets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  purpose: text("purpose", { enum: ["train", "eval"] }).notNull(),
  filter: jsonb("filter").$type<Record<string, unknown>>().notNull(),
  counts: jsonb("counts").$type<DatasetCounts>().notNull(),
  manifestKey: text("manifest_key").notNull(),
  sha256: text("sha256").notNull(),
  leakedTunes: jsonb("leaked_tunes").$type<number[]>().notNull().default([]), // eval-role tunes found in a train set: must be empty
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ml_dataset_name_idx").on(t.name)]);

export const mlRuns = ml.table("runs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  gitSha: text("git_sha"),
  args: jsonb("args").$type<Record<string, unknown>>().notNull(),
  trainDatasetId: integer("train_dataset_id").references(() => mlDatasets.id),
  evalDatasetId: integer("eval_dataset_id").references(() => mlDatasets.id),
  initRunId: integer("init_run_id"),
  status: text("status", { enum: ["running", "finished", "failed"] }).notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [uniqueIndex("ml_run_name_idx").on(t.name, t.startedAt)]);

// In-training evaluations, diagnose.py comparisons and benchmark results.
export const mlRunEvals = ml.table("run_evals", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => mlRuns.id, { onDelete: "cascade" }),
  step: integer("step").notNull(),
  datasetId: integer("dataset_id").references(() => mlDatasets.id),
  metrics: jsonb("metrics").$type<Record<string, number>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ml_run_eval_run_idx").on(t.runId, t.step)]);
