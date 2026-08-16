ALTER TABLE "scenarios" ADD COLUMN "budget_profile_id" integer;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "contribution_profile_id" integer;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_budget_profile_id_budget_profiles_id_fk" FOREIGN KEY ("budget_profile_id") REFERENCES "public"."budget_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_contribution_profile_id_contribution_profiles_id_fk" FOREIGN KEY ("contribution_profile_id") REFERENCES "public"."contribution_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scenarios_budget_profile_id_idx" ON "scenarios" USING btree ("budget_profile_id");--> statement-breakpoint
CREATE INDEX "scenarios_contribution_profile_id_idx" ON "scenarios" USING btree ("contribution_profile_id");