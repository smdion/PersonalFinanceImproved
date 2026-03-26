-- Index on savings_goals.parent_goal_id for FK lookup performance.
CREATE INDEX IF NOT EXISTS "savings_goals_parent_goal_id_idx"
  ON "savings_goals" ("parent_goal_id");
