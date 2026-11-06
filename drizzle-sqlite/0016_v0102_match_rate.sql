-- A percent match gets its rate as a fraction beside the whole-percent
-- employer_match_value, which stays. The rows are filled by the converter
-- (src/lib/db/v0102-match-rate.ts) after this SQL, as restore does to an
-- older backup. A replay skips the column once added; the converter fills
-- only an empty rate.
ALTER TABLE `contribution_accounts` ADD `employer_match_rate` text;