CREATE TABLE "irmaa_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_status" text NOT NULL,
	"brackets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ltcg_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_status" text NOT NULL,
	"brackets" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "irmaa_brackets_year_status_idx" ON "irmaa_brackets" USING btree ("tax_year","filing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "ltcg_brackets_year_status_idx" ON "ltcg_brackets" USING btree ("tax_year","filing_status");