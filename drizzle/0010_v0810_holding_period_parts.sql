DROP INDEX "holding_periods_account_start_idx";--> statement-breakpoint
ALTER TABLE "holding_periods" ADD COLUMN "sub_key" text;--> statement-breakpoint
CREATE INDEX "holding_periods_account_part_start_idx" ON "holding_periods" USING btree ("performance_account_id","sub_key","start_date");--> statement-breakpoint
ALTER TABLE "holding_periods" ADD CONSTRAINT "holding_periods_sub_key_check" CHECK ("holding_periods"."sub_key" IS NULL OR left("holding_periods"."sub_key", length("holding_periods"."performance_account_id"::text) + 1) = "holding_periods"."performance_account_id"::text || '_');