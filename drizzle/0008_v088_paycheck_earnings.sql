CREATE TABLE "paycheck_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"earning_name" text NOT NULL,
	"is_cash" boolean DEFAULT true NOT NULL,
	"federal_taxable" boolean DEFAULT true NOT NULL,
	"fica_taxable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paycheck_earnings" ADD CONSTRAINT "paycheck_earnings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paycheck_earnings_job_id_idx" ON "paycheck_earnings" USING btree ("job_id");