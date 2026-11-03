CREATE TABLE "tune_emoji_suggestions" (
	"tune_id" integer PRIMARY KEY NOT NULL,
	"emoji" text NOT NULL,
	"matcher_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_tunes" ADD COLUMN "emoji_override" text;