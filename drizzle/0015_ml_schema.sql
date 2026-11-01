CREATE SCHEMA "ml";
--> statement-breakpoint
CREATE TABLE "ml"."datasets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"filter" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"manifest_key" text NOT NULL,
	"sha256" text NOT NULL,
	"leaked_tunes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml"."run_evals" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step" integer NOT NULL,
	"dataset_id" integer,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml"."runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"git_sha" text,
	"args" jsonb NOT NULL,
	"train_dataset_id" integer,
	"eval_dataset_id" integer,
	"init_run_id" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ml"."searches" (
	"query" text PRIMARY KEY NOT NULL,
	"harvester" text NOT NULL,
	"results" integer NOT NULL,
	"searched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml"."segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"start_s" double precision NOT NULL,
	"end_s" double precision NOT NULL,
	"tune_id" integer,
	"setting_id" integer,
	"set_id" text,
	"position" integer,
	"label_source" text NOT NULL,
	"confidence" real NOT NULL,
	"verified" text,
	"verified_at" timestamp with time zone,
	"instruments" text,
	"ensemble" text,
	"setting_tag" text,
	"notes" text,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ml_segment_span" CHECK ("ml"."segments"."end_s" > "ml"."segments"."start_s")
);
--> statement-breakpoint
CREATE TABLE "ml"."sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"channel" text,
	"duration_s" real,
	"licence" text,
	"meta" jsonb,
	"storage_key" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml"."tune_roles" (
	"tune_id" integer PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"reason" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ml"."run_evals" ADD CONSTRAINT "run_evals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ml"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml"."run_evals" ADD CONSTRAINT "run_evals_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "ml"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml"."runs" ADD CONSTRAINT "runs_train_dataset_id_datasets_id_fk" FOREIGN KEY ("train_dataset_id") REFERENCES "ml"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml"."runs" ADD CONSTRAINT "runs_eval_dataset_id_datasets_id_fk" FOREIGN KEY ("eval_dataset_id") REFERENCES "ml"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ml"."segments" ADD CONSTRAINT "segments_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "ml"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ml_dataset_name_idx" ON "ml"."datasets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ml_run_eval_run_idx" ON "ml"."run_evals" USING btree ("run_id","step");--> statement-breakpoint
CREATE UNIQUE INDEX "ml_run_name_idx" ON "ml"."runs" USING btree ("name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ml_segment_source_start_tune_idx" ON "ml"."segments" USING btree ("source_id","start_s","tune_id");--> statement-breakpoint
CREATE INDEX "ml_segment_tune_idx" ON "ml"."segments" USING btree ("tune_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ml_source_kind_external_idx" ON "ml"."sources" USING btree ("kind","external_id");--> statement-breakpoint
CREATE INDEX "ml_source_kind_idx" ON "ml"."sources" USING btree ("kind");