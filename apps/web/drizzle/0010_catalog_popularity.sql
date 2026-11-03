CREATE TABLE "catalog_tunes" (
	"tune_id" integer PRIMARY KEY NOT NULL,
	"tunebooks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_tune_popularity_idx" ON "catalog_tunes" USING btree ("tunebooks");