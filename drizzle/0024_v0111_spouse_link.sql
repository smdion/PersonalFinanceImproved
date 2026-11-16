-- v0.11.1 spouse link (tag 0024): a person's spouse on the joint return, on both rows.
-- No converter: every saved row (and an older backup's) has no link, so nothing moves.
-- SET NULL: deleting a spouse unlinks the other.
ALTER TABLE "people" ADD COLUMN "spouse_person_id" integer;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_spouse_person_id_people_id_fk" FOREIGN KEY ("spouse_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
