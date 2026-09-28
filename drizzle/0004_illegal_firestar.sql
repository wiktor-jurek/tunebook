CREATE TABLE "set_tunes" (
	"set_id" uuid NOT NULL,
	"tune_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "set_tunes_set_id_tune_id_pk" PRIMARY KEY("set_id","tune_id"),
	CONSTRAINT "set_position_nonnegative" CHECK ("set_tunes"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tune_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_tunes" DROP CONSTRAINT "book_tunes_book_id_tune_id_pk";--> statement-breakpoint
ALTER TABLE "book_tunes" ALTER COLUMN "tune_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "book_tunes" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "book_tunes" ADD COLUMN "set_id" uuid;--> statement-breakpoint
ALTER TABLE "set_tunes" ADD CONSTRAINT "set_tunes_set_id_tune_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tune_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_tunes" ADD CONSTRAINT "set_tunes_tune_id_saved_tunes_id_fk" FOREIGN KEY ("tune_id") REFERENCES "public"."saved_tunes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tune_sets" ADD CONSTRAINT "tune_sets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "set_tune_order_idx" ON "set_tunes" USING btree ("set_id","position");--> statement-breakpoint
CREATE INDEX "set_tune_membership_idx" ON "set_tunes" USING btree ("tune_id");--> statement-breakpoint
CREATE INDEX "set_user_idx" ON "tune_sets" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "book_tunes" ADD CONSTRAINT "book_tunes_set_id_tune_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."tune_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_set_idx" ON "book_tunes" USING btree ("book_id","set_id");--> statement-breakpoint
ALTER TABLE "book_tunes" ADD CONSTRAINT "book_entry_one_kind" CHECK (("book_tunes"."tune_id" IS NULL) <> ("book_tunes"."set_id" IS NULL));
