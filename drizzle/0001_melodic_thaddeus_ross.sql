CREATE TABLE "account_holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"performance_account_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"weight_bps" integer NOT NULL,
	"expense_ratio" numeric(12, 6),
	"asset_class_id" integer,
	"asset_class_source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "account_holdings_weight_range" CHECK (weight_bps >= 0 AND weight_bps <= 10000)
);
--> statement-breakpoint
CREATE TABLE "pending_rollovers" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_account_performance_id" integer NOT NULL,
	"destination_performance_account_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"sale_date" date NOT NULL,
	"sale_year" integer NOT NULL,
	"apply_year" integer NOT NULL,
	"notes" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "savings_goals" DROP CONSTRAINT IF EXISTS "savings_goals_target_mode_check";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "extra_paycheck_routing" jsonb;--> statement-breakpoint
ALTER TABLE "savings_allocation_overrides" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_planned_transactions" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_snapshot_id_portfolio_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."portfolio_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_rollovers" ADD CONSTRAINT "pending_rollovers_source_account_performance_id_account_performance_id_fk" FOREIGN KEY ("source_account_performance_id") REFERENCES "public"."account_performance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_rollovers" ADD CONSTRAINT "pending_rollovers_destination_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("destination_performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_holdings_acct_snap_ticker_idx" ON "account_holdings" USING btree ("performance_account_id","snapshot_id","ticker");--> statement-breakpoint
CREATE INDEX "account_holdings_perf_acct_idx" ON "account_holdings" USING btree ("performance_account_id");--> statement-breakpoint
CREATE INDEX "account_holdings_snapshot_idx" ON "account_holdings" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "account_holdings_asset_class_idx" ON "account_holdings" USING btree ("asset_class_id");--> statement-breakpoint
CREATE INDEX "pending_rollovers_source_idx" ON "pending_rollovers" USING btree ("source_account_performance_id");--> statement-breakpoint
CREATE INDEX "pending_rollovers_dest_idx" ON "pending_rollovers" USING btree ("destination_performance_account_id");--> statement-breakpoint
CREATE INDEX "pending_rollovers_sale_year_idx" ON "pending_rollovers" USING btree ("sale_year");--> statement-breakpoint
CREATE INDEX "pending_rollovers_confirmed_idx" ON "pending_rollovers" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "savings_planned_tx_source_idx" ON "savings_planned_transactions" USING btree ("source");--> statement-breakpoint
-- Migrate extra_paycheck_routing from ExtraPaycheckRule[] to {rules, overrides} shape
UPDATE "jobs"
SET "extra_paycheck_routing" = jsonb_build_object('rules', "extra_paycheck_routing", 'overrides', '[]'::jsonb)
WHERE "extra_paycheck_routing" IS NOT NULL
  AND jsonb_typeof("extra_paycheck_routing") = 'array';--> statement-breakpoint
-- Remove stale rule rows written by the old materializer to savings_allocation_overrides
DELETE FROM "savings_allocation_overrides" WHERE "source" = 'rule';