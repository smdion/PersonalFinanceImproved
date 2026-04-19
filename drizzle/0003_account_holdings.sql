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

ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_snapshot_id_portfolio_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."portfolio_snapshots"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX "account_holdings_acct_snap_ticker_idx" ON "account_holdings" USING btree ("performance_account_id","snapshot_id","ticker");
CREATE INDEX "account_holdings_perf_acct_idx" ON "account_holdings" USING btree ("performance_account_id");
CREATE INDEX "account_holdings_snapshot_idx" ON "account_holdings" USING btree ("snapshot_id");
CREATE INDEX "account_holdings_asset_class_idx" ON "account_holdings" USING btree ("asset_class_id");
