CREATE TABLE "budget_income_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"month_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source" text DEFAULT 'rule' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_income_adjustments" ADD CONSTRAINT "budget_income_adjustments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_income_adjustments_job_month_idx" ON "budget_income_adjustments" USING btree ("job_id","month_date");