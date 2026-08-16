CREATE TABLE "savings_goal_profile_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"goal_id" integer NOT NULL,
	"budget_profile_id" integer NOT NULL,
	"allocation_percent" numeric(6, 3),
	"monthly_contribution" numeric(14, 2)
);
--> statement-breakpoint
ALTER TABLE "savings_goal_profile_allocations" ADD CONSTRAINT "savings_goal_profile_allocations_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_profile_allocations" ADD CONSTRAINT "savings_goal_profile_allocations_budget_profile_id_budget_profiles_id_fk" FOREIGN KEY ("budget_profile_id") REFERENCES "public"."budget_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goal_profile_alloc_goal_profile_idx" ON "savings_goal_profile_allocations" USING btree ("goal_id","budget_profile_id");