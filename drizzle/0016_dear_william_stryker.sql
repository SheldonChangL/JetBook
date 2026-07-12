CREATE TYPE "public"."page_kind" AS ENUM('page', 'group', 'external_link');--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "kind" "page_kind" DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "external_url" text;