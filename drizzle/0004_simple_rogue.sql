CREATE TABLE "holding_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"simplefin_account_id" integer,
	"performance_account_id" integer,
	"security_id" integer NOT NULL,
	"balance_date" timestamp with time zone,
	"as_of" date NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"reported_market_value" numeric(14, 2),
	"avg_cost_per_share" numeric(20, 8),
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holding_observations_one_account_check" CHECK (("holding_observations"."simplefin_account_id" IS NULL) <> ("holding_observations"."performance_account_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "investment_transaction_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_contains" text NOT NULL,
	"description_contains" text NOT NULL,
	"sign" text,
	"kind" text NOT NULL,
	"review_when" text,
	"max_fraction_of_balance" numeric(12, 6),
	"priority" integer DEFAULT 0 NOT NULL,
	"sample_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_transaction_rules_nonempty_check" CHECK (length("investment_transaction_rules"."institution_contains") > 0 AND length("investment_transaction_rules"."description_contains") > 0)
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"simplefin_account_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"posted" date NOT NULL,
	"transacted" date,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"kind_override" text,
	"kind_override_source" text,
	"voided_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text,
	"source_symbol" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"institution" text,
	"source_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simplefin_account_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"simplefin_account_id" integer NOT NULL,
	"balance_date" timestamp with time zone NOT NULL,
	"balance" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_request_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint" text NOT NULL,
	"http_status" integer,
	"outcome" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holding_observations" ADD CONSTRAINT "holding_observations_simplefin_account_id_simplefin_accounts_id_fk" FOREIGN KEY ("simplefin_account_id") REFERENCES "public"."simplefin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_observations" ADD CONSTRAINT "holding_observations_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_observations" ADD CONSTRAINT "holding_observations_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_simplefin_account_id_simplefin_accounts_id_fk" FOREIGN KEY ("simplefin_account_id") REFERENCES "public"."simplefin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_account_balances" ADD CONSTRAINT "simplefin_account_balances_simplefin_account_id_simplefin_accounts_id_fk" FOREIGN KEY ("simplefin_account_id") REFERENCES "public"."simplefin_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_observations_simplefin_idx" ON "holding_observations" USING btree ("simplefin_account_id","security_id","as_of") WHERE "holding_observations"."simplefin_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_observations_manual_idx" ON "holding_observations" USING btree ("performance_account_id","security_id","as_of") WHERE "holding_observations"."performance_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "holding_observations_security_idx" ON "holding_observations" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "holding_observations_perf_account_idx" ON "holding_observations" USING btree ("performance_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_transactions_external_idx" ON "investment_transactions" USING btree ("simplefin_account_id","external_id");--> statement-breakpoint
CREATE INDEX "investment_transactions_account_posted_idx" ON "investment_transactions" USING btree ("simplefin_account_id","posted");--> statement-breakpoint
CREATE UNIQUE INDEX "securities_ticker_idx" ON "securities" USING btree ("ticker") WHERE "securities"."ticker" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "securities_untickered_identity_idx" ON "securities" USING btree ("institution","source_description") WHERE "securities"."ticker" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "simplefin_account_balances_account_date_idx" ON "simplefin_account_balances" USING btree ("simplefin_account_id","balance_date");--> statement-breakpoint
CREATE INDEX "sync_request_log_service_requested_idx" ON "sync_request_log" USING btree ("service","requested_at");