-- Batch 6 audit finding 4 (Phase 5.2b): mortgage_loans.refinanced_from_id
-- was a plain, unenforced self-reference. Data audit (2026-08-20, against
-- ledgr/dev_ledgr/ledgrdemo) confirmed zero orphaned values, clearing the
-- way to add the constraint. ON DELETE SET NULL matches the existing
-- self-referencing precedent (savings_goals.parent_goal_id) — deleting an
-- old, refinanced-away loan shouldn't be blocked by a newer loan's pointer
-- to it; the pointer just clears.
ALTER TABLE "mortgage_loans" ADD CONSTRAINT "mortgage_loans_refinanced_from_id_fk" FOREIGN KEY ("refinanced_from_id") REFERENCES "mortgage_loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mortgage_loans_refinanced_from_id_idx" ON "mortgage_loans" USING btree ("refinanced_from_id");
