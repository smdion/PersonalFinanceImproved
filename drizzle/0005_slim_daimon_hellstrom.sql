CREATE TABLE "job_bonus_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"year" integer NOT NULL,
	"override_amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "job_bonus_overrides" ADD CONSTRAINT "job_bonus_overrides_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_bonus_overrides_job_year_idx" ON "job_bonus_overrides" USING btree ("job_id","year");--> statement-breakpoint
CREATE INDEX "job_bonus_overrides_job_id_idx" ON "job_bonus_overrides" USING btree ("job_id");--> statement-breakpoint
-- Migrate existing flat overrides into the current-year row. The flat
-- column had no year concept, so "current calendar year" is the closest
-- faithful interpretation of what the value was being used for.
INSERT INTO "job_bonus_overrides" ("job_id", "year", "override_amount")
SELECT "id", EXTRACT(YEAR FROM CURRENT_DATE)::integer, "bonus_override"
FROM "jobs"
WHERE "bonus_override" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "bonus_override";