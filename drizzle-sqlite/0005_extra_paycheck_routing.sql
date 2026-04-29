ALTER TABLE `jobs` ADD `extra_paycheck_routing` text;--> statement-breakpoint
ALTER TABLE `savings_allocation_overrides` ADD `source` text NOT NULL DEFAULT 'manual';
