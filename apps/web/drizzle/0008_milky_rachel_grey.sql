CREATE TABLE "book_popular_tunes" (
	"book_id" uuid NOT NULL,
	"tune_id" integer NOT NULL,
	CONSTRAINT "book_popular_tunes_book_id_tune_id_pk" PRIMARY KEY("book_id","tune_id")
);
--> statement-breakpoint
ALTER TABLE "book_popular_tunes" ADD CONSTRAINT "book_popular_tunes_book_id_tunebooks_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."tunebooks"("id") ON DELETE cascade ON UPDATE no action;