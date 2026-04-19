CREATE TABLE IF NOT EXISTS "pending_rollovers" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_account_performance_id" integer NOT NULL,
  "destination_performance_account_id" integer NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "sale_date" date NOT NULL,
  "sale_year" integer NOT NULL,
  "apply_year" integer NOT NULL,
  "notes" text,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pending_rollovers_source_account_performance_id_account_performance_id_fk"
    FOREIGN KEY ("source_account_performance_id") REFERENCES "account_performance"("id") ON DELETE restrict,
  CONSTRAINT "pending_rollovers_destination_performance_account_id_performance_accounts_id_fk"
    FOREIGN KEY ("destination_performance_account_id") REFERENCES "performance_accounts"("id") ON DELETE restrict
);

CREATE INDEX IF NOT EXISTS "pending_rollovers_source_idx" ON "pending_rollovers" ("source_account_performance_id");
CREATE INDEX IF NOT EXISTS "pending_rollovers_dest_idx" ON "pending_rollovers" ("destination_performance_account_id");
CREATE INDEX IF NOT EXISTS "pending_rollovers_sale_year_idx" ON "pending_rollovers" ("sale_year");
CREATE INDEX IF NOT EXISTS "pending_rollovers_confirmed_idx" ON "pending_rollovers" ("confirmed_at");
