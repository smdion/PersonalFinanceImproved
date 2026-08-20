-- SQLite twin of drizzle/0019_mortgage_refinanced_from_fk.sql (Postgres) —
-- see that file's header for the full rationale. SQLite doesn't support
-- adding a FOREIGN KEY constraint to an existing table without a full
-- table rebuild, so only the index is mirrored here — same pattern as
-- savings_goals.parent_goal_id, which also has no live FK on the SQLite
-- side despite being enforced on Postgres.
CREATE INDEX `mortgage_loans_refinanced_from_id_idx` ON `mortgage_loans` (`refinanced_from_id`);
