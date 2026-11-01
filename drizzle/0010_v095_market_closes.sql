-- Tiingo daily closes kept in the database (re-fetchable; not backed up):
-- each close is fetched once, so a restart or a rate limit loses nothing.
CREATE TABLE "market_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"close" numeric(18, 6) NOT NULL,
	"div_cash" numeric(18, 6) DEFAULT '0' NOT NULL,
	"split_factor" numeric(18, 8) DEFAULT '1' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_closes_ticker_date_idx" ON "market_closes" USING btree ("ticker","date");