-- Backfill a mandatory row for every (goal, profile) pair that doesn't
-- already have a profile-specific override — using each pair's CURRENTLY
-- resolved value (the goal's shared default, since no profile-specific row
-- exists yet) so nothing changes numerically the moment this ships. Only
-- NEW goals/profiles created after this migration start at $0 — see
-- savings_goal_profile_allocations' table comment.
INSERT INTO "savings_goal_profile_allocations" ("goal_id", "budget_profile_id", "allocation_percent", "monthly_contribution")
SELECT g."id", p."id", g."allocation_percent", g."monthly_contribution"
FROM "savings_goals" g
CROSS JOIN "budget_profiles" p
WHERE g."is_active" = true
ON CONFLICT ("goal_id", "budget_profile_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "savings_goals" DROP COLUMN "monthly_contribution";--> statement-breakpoint
ALTER TABLE "savings_goals" DROP COLUMN "allocation_percent";