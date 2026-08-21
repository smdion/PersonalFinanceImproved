-- Employer match grouping fix (server/helpers/contribution.ts,
-- computeGroupedEmployerMatch): a real employer match cap applies to a
-- physical account's COMBINED contribution, not each Roth/Traditional
-- split separately. The new grouped computation requires exactly one
-- "winning" row per (job/person, accountType, parentCategory) group to
-- carry real match config — two independently-configured siblings is an
-- ambiguous data state the app throws on rather than silently guessing
-- at. These two partial unique indexes (job-linked accounts, and the
-- jobless-fallback-to-person case every caller already resolves the same
-- way) stop that ambiguous state from being written in the first place,
-- rather than relying on the app-level throw alone.
CREATE UNIQUE INDEX "contribution_accounts_job_match_unq" ON "contribution_accounts" USING btree ("job_id","account_type","parent_category") WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NOT NULL AND "contribution_accounts"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_accounts_person_match_unq" ON "contribution_accounts" USING btree ("person_id","account_type","parent_category") WHERE "contribution_accounts"."employer_match_type" <> 'none' AND "contribution_accounts"."job_id" IS NULL AND "contribution_accounts"."is_active" = true;
