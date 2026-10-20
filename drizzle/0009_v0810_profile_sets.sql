CREATE UNIQUE INDEX "scenarios_name_unique" ON "scenarios" USING btree ("name");--> statement-breakpoint
ALTER TABLE "budget_profiles" DROP COLUMN "column_contribution_profile_ids";--> statement-breakpoint
ALTER TABLE "budget_profiles" DROP COLUMN "column_salary_profile_ids";--> statement-breakpoint
ALTER TABLE "scenarios" DROP COLUMN "overrides";--> statement-breakpoint
ALTER TABLE "scenarios" DROP COLUMN "is_baseline";