CREATE TABLE "recording_tunes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"tune_id" integer NOT NULL,
	"setting_id" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recording_tunes" ADD CONSTRAINT "recording_tunes_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_tune_recording_idx" ON "recording_tunes" USING btree ("recording_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "recording_storage_key_idx" ON "recordings" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "recording_user_idx" ON "recordings" USING btree ("user_id","recorded_at");