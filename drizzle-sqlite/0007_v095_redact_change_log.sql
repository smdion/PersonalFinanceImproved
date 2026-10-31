-- Credentials never belong in the change log (see drizzle/0007): replace
-- the keys in lib/utils/redact-secrets.ts at the top level of each logged
-- input. Safe to re-run.
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.accessToken', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.accessToken') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.apiKey', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.apiKey') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.setupToken', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.setupToken') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.accessUrl', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.accessUrl') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.token', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.token') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.password', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.password') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.passwordHash', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.passwordHash') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.secret', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.secret') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.clientSecret', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.clientSecret') IS NOT NULL;
--> statement-breakpoint
UPDATE `change_log` SET `new_value` = json_set(`new_value`, '$.config', '[redacted]') WHERE json_valid(`new_value`) AND json_type(`new_value`, '$.config') IS NOT NULL;
