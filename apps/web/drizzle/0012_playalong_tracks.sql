CREATE TABLE "playalong_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setting_id" integer NOT NULL,
	"tune_id" integer NOT NULL,
	"label" text NOT NULL,
	"bpm" smallint,
	"duration_ms" integer NOT NULL,
	"storage_key" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playalong_tracks" ADD CONSTRAINT "playalong_tracks_setting_id_catalog_settings_setting_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."catalog_settings"("setting_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playalong_storage_key_idx" ON "playalong_tracks" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "playalong_setting_idx" ON "playalong_tracks" USING btree ("setting_id");