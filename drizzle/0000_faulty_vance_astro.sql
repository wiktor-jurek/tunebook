CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_tunes" (
	"book_id" uuid NOT NULL,
	"tune_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "book_tunes_book_id_tune_id_pk" PRIMARY KEY("book_id","tune_id"),
	CONSTRAINT "position_nonnegative" CHECK ("book_tunes"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_settings" (
	"setting_id" integer PRIMARY KEY NOT NULL,
	"tune_id" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text,
	"meter" text,
	"mode" text,
	"abc" text NOT NULL,
	"contributor" text,
	"composer" text,
	"source_url" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_tunes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"setting_id" integer NOT NULL,
	"tune_id" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text,
	"meter" text,
	"mode" text,
	"abc" text NOT NULL,
	"contributor" text,
	"composer" text,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tunes" ADD CONSTRAINT "book_tunes_book_id_tunebooks_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."tunebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tunes" ADD CONSTRAINT "book_tunes_tune_id_saved_tunes_id_fk" FOREIGN KEY ("tune_id") REFERENCES "public"."saved_tunes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_tunes" ADD CONSTRAINT "saved_tunes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tunebooks" ADD CONSTRAINT "tunebooks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "book_tune_order_idx" ON "book_tunes" USING btree ("book_id","position");--> statement-breakpoint
CREATE INDEX "catalog_title_idx" ON "catalog_settings" USING btree ("title");--> statement-breakpoint
CREATE INDEX "catalog_tune_idx" ON "catalog_settings" USING btree ("tune_id");--> statement-breakpoint
CREATE INDEX "folder_parent_idx" ON "folders" USING btree ("user_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_user_setting_idx" ON "saved_tunes" USING btree ("user_id","setting_id");--> statement-breakpoint
CREATE INDEX "saved_user_title_idx" ON "saved_tunes" USING btree ("user_id","title");--> statement-breakpoint
CREATE INDEX "book_folder_idx" ON "tunebooks" USING btree ("user_id","folder_id");