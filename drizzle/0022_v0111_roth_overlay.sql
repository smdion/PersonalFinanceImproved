-- v0.11.1 Roth bracket overlay switch (tag 0022). A nullable column with
-- no default: the converter in src/lib/db/migrate/v0111-roth-overlay.ts runs
-- after this SQL, as restore runs it on an older backup. A row saved before
-- this tag has no switch: it gets the overlay on, and an empty target the
-- 12% it always read. Writers always set the switch from here on, so a
-- replay finds every row set and writes nothing.
ALTER TABLE "retirement_settings" ADD COLUMN "roth_bracket_overlay" boolean;
