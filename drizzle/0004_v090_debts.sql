CREATE TABLE "debts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner_person_id" integer,
	"balance" numeric(14, 2) NOT NULL,
	"balance_as_of" date NOT NULL,
	"original_amount" numeric(14, 2),
	"interest_rate" numeric(8, 6),
	"monthly_payment" numeric(14, 2),
	"opened_date" date,
	"paid_off_date" date,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debts_owner_person_id_idx" ON "debts" USING btree ("owner_person_id");