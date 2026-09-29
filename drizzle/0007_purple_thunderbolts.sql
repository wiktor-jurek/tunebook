CREATE TABLE "tune_practice" (
	"user_id" text NOT NULL,
	"tune_id" integer NOT NULL,
	"playable_tempo" integer,
	"level_override" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tune_practice_user_id_tune_id_pk" PRIMARY KEY("user_id","tune_id"),
	CONSTRAINT "practice_tempo_range" CHECK ("tune_practice"."playable_tempo" IS NULL OR "tune_practice"."playable_tempo" BETWEEN 50 AND 150),
	CONSTRAINT "practice_level_values" CHECK ("tune_practice"."level_override" IS NULL OR "tune_practice"."level_override" IN ('unlearned', 'learning', 'learned', 'mastered'))
);
--> statement-breakpoint
ALTER TABLE "tune_practice" ADD CONSTRAINT "tune_practice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;