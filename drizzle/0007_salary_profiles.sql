CREATE TABLE "salary_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"salary_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
-- Temporary link column (NOT part of the Drizzle schema) used only to carry
-- the contribution_profiles.id each backfilled Salary Profile came from, so
-- the pins below can be repointed. Dropped at the end of this migration.
ALTER TABLE "salary_profiles" ADD COLUMN "source_contribution_profile_id" integer;--> statement-breakpoint
-- Salary overrides used to live on contribution_profiles. Split them out into
-- a matching Salary Profile per contribution profile that actually carried
-- one, so today's paired behavior is preserved on upgrade. Names are unique
-- on both tables, so copying the name across is collision-safe.
INSERT INTO "salary_profiles" ("name", "description", "salary_overrides", "source_contribution_profile_id")
SELECT "name", "description", "salary_overrides", "id"
FROM "contribution_profiles"
WHERE "salary_overrides" IS NOT NULL AND "salary_overrides" <> '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "salary_profile_id" integer;--> statement-breakpoint
-- Plan pin: a Plan that pinned a Contribution Profile carrying salary
-- overrides now also pins the Salary Profile split out of it.
UPDATE "scenarios" SET "salary_profile_id" = sp."id"
FROM "salary_profiles" sp
WHERE sp."source_contribution_profile_id" = "scenarios"."contribution_profile_id";--> statement-breakpoint
ALTER TABLE "retirement_salary_overrides" ADD COLUMN "salary_profile_id" integer;--> statement-breakpoint
-- Retirement profile-switch rows: same repointing.
UPDATE "retirement_salary_overrides" SET "salary_profile_id" = sp."id"
FROM "salary_profiles" sp
WHERE sp."source_contribution_profile_id" = "retirement_salary_overrides"."contribution_profile_id";--> statement-breakpoint
ALTER TABLE "budget_profiles" ADD COLUMN "column_salary_profile_ids" jsonb;--> statement-breakpoint
-- Budget-column pin: build a same-length array where each entry is the
-- Salary Profile split out of that column's Contribution Profile (JSON null
-- when the column had no contribution profile, or its profile carried no
-- salary overrides). WITH ORDINALITY keeps column order stable.
UPDATE "budget_profiles" bp
SET "column_salary_profile_ids" = (
	SELECT jsonb_agg(COALESCE(to_jsonb(sp."id"), 'null'::jsonb) ORDER BY t.ord)
	FROM jsonb_array_elements(bp."column_contribution_profile_ids") WITH ORDINALITY AS t(elem, ord)
	LEFT JOIN "salary_profiles" sp
		ON sp."source_contribution_profile_id" = (t.elem #>> '{}')::integer
)
WHERE bp."column_contribution_profile_ids" IS NOT NULL
	AND jsonb_typeof(bp."column_contribution_profile_ids") = 'array'
	AND jsonb_array_length(bp."column_contribution_profile_ids") > 0;--> statement-breakpoint
ALTER TABLE "retirement_salary_overrides" ADD CONSTRAINT "retirement_salary_overrides_salary_profile_id_salary_profiles_id_fk" FOREIGN KEY ("salary_profile_id") REFERENCES "public"."salary_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_salary_profile_id_salary_profiles_id_fk" FOREIGN KEY ("salary_profile_id") REFERENCES "public"."salary_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retirement_salary_overrides_contribution_profile_id_idx" ON "retirement_salary_overrides" USING btree ("contribution_profile_id");--> statement-breakpoint
CREATE INDEX "retirement_salary_overrides_salary_profile_id_idx" ON "retirement_salary_overrides" USING btree ("salary_profile_id");--> statement-breakpoint
CREATE INDEX "scenarios_salary_profile_id_idx" ON "scenarios" USING btree ("salary_profile_id");--> statement-breakpoint
ALTER TABLE "salary_profiles" DROP COLUMN "source_contribution_profile_id";--> statement-breakpoint
ALTER TABLE "contribution_profiles" DROP COLUMN "salary_overrides";
