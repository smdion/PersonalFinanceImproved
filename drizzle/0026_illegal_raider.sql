ALTER TABLE "roth_basis" RENAME TO "account_basis";--> statement-breakpoint
ALTER TABLE "account_basis" DROP CONSTRAINT "roth_basis_performance_account_id_performance_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "account_basis" DROP CONSTRAINT "roth_basis_owner_person_id_people_id_fk";
--> statement-breakpoint
DROP INDEX "roth_basis_account_owner_year_idx";--> statement-breakpoint
DROP INDEX "roth_basis_owner_person_id_idx";--> statement-breakpoint
DROP INDEX "roth_basis_year_idx";--> statement-breakpoint
ALTER TABLE "account_basis" ADD CONSTRAINT "account_basis_performance_account_id_performance_accounts_id_fk" FOREIGN KEY ("performance_account_id") REFERENCES "public"."performance_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_basis" ADD CONSTRAINT "account_basis_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_basis_account_owner_year_idx" ON "account_basis" USING btree ("performance_account_id","owner_person_id","year");--> statement-breakpoint
CREATE INDEX "account_basis_owner_person_id_idx" ON "account_basis" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "account_basis_year_idx" ON "account_basis" USING btree ("year");