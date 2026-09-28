CREATE TABLE "book_shares" (
	"book_id" uuid NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_shares_book_id_email_pk" PRIMARY KEY("book_id","email")
);
--> statement-breakpoint
ALTER TABLE "tunebooks" ADD COLUMN "link_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_shares" ADD CONSTRAINT "book_shares_book_id_tunebooks_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."tunebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_share_email_idx" ON "book_shares" USING btree ("email");