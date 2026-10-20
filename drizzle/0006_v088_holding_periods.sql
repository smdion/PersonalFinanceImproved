CREATE TABLE "holding_period_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"holding_period_id" integer NOT NULL,
	"security_id" integer NOT NULL,
	"weight" numeric(12, 6) NOT NULL,
	CONSTRAINT "holding_period_weights_range_check" CHECK ("holding_period_weights"."weight" > 0 AND "holding_period_weights"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "holding_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"performance_account_id" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"basis" text NOT NULL,
	"fit_quality" numeric(12, 6),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holding_periods_dates_check" CHECK ("holding_periods"."end_date" IS NULL OR "holding_periods"."end_date" >= "holding_periods"."start_date")
);
--> statement-breakpoint
ALTER TABLE "holding_period_weights" ADD CONSTRAINT "holding_period_weights_holding_period_id_holding_periods_id_fk" FOREIGN KEY ("holding_period_id") REFERENCES "public"."holding_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_period_weights" ADD CONSTRAINT "holding_period_weights_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_periods" ADD CONSTRAINT "holding_periods_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_period_weights_period_security_idx" ON "holding_period_weights" USING btree ("holding_period_id","security_id");--> statement-breakpoint
CREATE INDEX "holding_period_weights_security_idx" ON "holding_period_weights" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "holding_periods_account_start_idx" ON "holding_periods" USING btree ("performance_account_id","start_date");