ALTER TABLE "jobs" ADD COLUMN "extra_paycheck_routing" jsonb;--> statement-breakpoint
ALTER TABLE "savings_allocation_overrides" ADD COLUMN "source" text NOT NULL DEFAULT 'manual';
