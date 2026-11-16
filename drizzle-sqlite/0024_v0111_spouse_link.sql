-- v0.11.1 spouse link (tag 0024): a person's spouse on the joint return, on both rows.
-- No converter: every saved row (and an older backup's) has no link, so nothing moves.
-- SET NULL (by hand: drizzle-kit drops it here): deleting a spouse unlinks the other.
ALTER TABLE `people` ADD `spouse_person_id` integer REFERENCES people(id) ON DELETE set null;
