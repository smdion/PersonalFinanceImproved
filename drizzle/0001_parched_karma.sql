CREATE TABLE "savings_planned_tx_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"planned_tx_id" integer NOT NULL,
	"occurrence_month" date NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "savings_planned_tx_settlements" ADD CONSTRAINT "savings_planned_tx_settlements_planned_tx_id_savings_planned_transactions_id_fk" FOREIGN KEY ("planned_tx_id") REFERENCES "public"."savings_planned_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "savings_planned_tx_settlements_occurrence_idx" ON "savings_planned_tx_settlements" USING btree ("planned_tx_id","occurrence_month");