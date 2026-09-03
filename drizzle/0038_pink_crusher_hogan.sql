CREATE TABLE "fpl_by_household" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"amounts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_year" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retirement_profiles" ADD COLUMN "tax_params_year" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "fpl_by_household_year_idx" ON "fpl_by_household" USING btree ("tax_year");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_params_year_idx" ON "tax_params" USING btree ("tax_year");