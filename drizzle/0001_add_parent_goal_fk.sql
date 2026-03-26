-- Add self-referential foreign key on savings_goals.parent_goal_id
-- Ensures parentGoalId references an existing savings goal.
-- SET NULL on delete so child goals are un-parented rather than cascade-deleted.
ALTER TABLE "savings_goals"
  ADD CONSTRAINT "savings_goals_parent_fk"
  FOREIGN KEY ("parent_goal_id") REFERENCES "savings_goals"("id")
  ON DELETE SET NULL;
