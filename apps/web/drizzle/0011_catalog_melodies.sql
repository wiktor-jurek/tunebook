CREATE TABLE "catalog_melodies" (
	"setting_id" integer PRIMARY KEY NOT NULL,
	"tune_id" integer NOT NULL,
	"pitches" smallint[] NOT NULL,
	"durations" smallint[] NOT NULL,
	"chars" integer[] NOT NULL,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_melodies" ADD CONSTRAINT "catalog_melodies_setting_id_catalog_settings_setting_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."catalog_settings"("setting_id") ON DELETE cascade ON UPDATE no action;