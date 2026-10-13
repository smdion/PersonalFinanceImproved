-- v0.8.6: index savings_goals.parent_goal_id. The schema also declares the
-- parent_goal_id → savings_goals.id key (ON DELETE SET NULL), but it is NOT
-- added here: SQLite can only add a key by rebuilding the table, and this
-- runner applies migrations inside a transaction, where PRAGMA foreign_keys
-- is ignored — DROP TABLE would cascade-delete every goal's savings history.
-- The app detaches sub-goals on delete instead (see gen-sqlite-schema.ts).
CREATE INDEX IF NOT EXISTS `savings_goals_parent_goal_id_idx` ON `savings_goals` (`parent_goal_id`);
