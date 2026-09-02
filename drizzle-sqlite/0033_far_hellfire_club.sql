DROP INDEX `retirement_settings_person_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `retirement_settings_profile_person_unq` ON `retirement_settings` (`profile_id`,`person_id`);