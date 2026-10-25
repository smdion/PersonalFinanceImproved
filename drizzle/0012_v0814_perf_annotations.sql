ALTER TABLE "account_performance" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "account_performance" ADD COLUMN "estimated_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "account_performance" ADD COLUMN "accepted_checks" jsonb DEFAULT '{}'::jsonb NOT NULL;