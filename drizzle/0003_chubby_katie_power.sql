CREATE TABLE "simplefin_balance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"total_balance" numeric(14, 2) NOT NULL,
	"account_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simplefin_balance_snapshots_snapshot_date_unique" UNIQUE("snapshot_date")
);
--> statement-breakpoint
CREATE INDEX "simplefin_balance_snapshots_date_idx" ON "simplefin_balance_snapshots" USING btree ("snapshot_date");