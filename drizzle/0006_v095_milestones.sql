-- Existing profiles keep today's projections: the four portfolio-sized
-- strategies that existed get Social Security out of the strategy's amount
-- (true) as the column is added, then lose the default — new rows and VPW
-- are null = the config default (Social Security on top). Safe to re-run:
-- a second ADD is skipped and touches no row.
ALTER TABLE "debts" ADD COLUMN "purchase_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "debts" ADD COLUMN "term_months" integer;--> statement-breakpoint
ALTER TABLE "debts" ADD COLUMN "api_balance" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "debts" ADD COLUMN "api_balance_date" date;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "vpw_cap" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "vpw_end_age" integer;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "cp_ss_in_amount" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "cp_ss_in_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "en_ss_in_amount" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "en_ss_in_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "vd_ss_in_amount" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "vd_ss_in_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "rmd_ss_in_amount" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "retirement_settings" ALTER COLUMN "rmd_ss_in_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "vpw_ss_in_amount" boolean;
