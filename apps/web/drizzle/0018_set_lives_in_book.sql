DROP INDEX "book_set_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "book_set_idx" ON "book_tunes" USING btree ("set_id");
