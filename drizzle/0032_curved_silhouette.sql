CREATE TABLE "retirement_profile_people" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"person_id" integer NOT NULL,
	"retirement_age" integer NOT NULL,
	"end_age" integer NOT NULL,
	"social_security_monthly" numeric(14, 2),
	"ss_start_age" integer,
	"rule_of_55_override" boolean,
	"salary_annual_increase" numeric(8, 6)
);
--> statement-breakpoint
CREATE TABLE "retirement_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retirement_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "profile_id" integer;--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "distribution_tax_rate_traditional" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "distribution_tax_rate_roth" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "distribution_tax_rate_hsa" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD COLUMN "distribution_tax_rate_brokerage" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "retirement_profile_id" integer;--> statement-breakpoint
ALTER TABLE "retirement_profile_people" ADD CONSTRAINT "retirement_profile_people_profile_id_retirement_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."retirement_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_profile_people" ADD CONSTRAINT "retirement_profile_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_profile_people_profile_person_unq" ON "retirement_profile_people" USING btree ("profile_id","person_id");--> statement-breakpoint
CREATE INDEX "retirement_profile_people_profile_id_idx" ON "retirement_profile_people" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "retirement_profile_people_person_id_idx" ON "retirement_profile_people" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "retirement_settings" ADD CONSTRAINT "retirement_settings_profile_id_retirement_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."retirement_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_retirement_profile_id_retirement_profiles_id_fk" FOREIGN KEY ("retirement_profile_id") REFERENCES "public"."retirement_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retirement_settings_profile_id_idx" ON "retirement_settings" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "scenarios_retirement_profile_id_idx" ON "scenarios" USING btree ("retirement_profile_id");--> statement-breakpoint
-- ===========================================================================
-- Retirement Profiles — step A backfill (expand phase)
--
-- Purely additive. Nothing reads these tables/columns yet; step B switches the
-- reads over. Behaviour after this migration must be BYTE-IDENTICAL, which is
-- the gate (a golden-baseline diff) this step is verified against.
-- ===========================================================================

-- 1. One profile, "Current Plan", for households that already have settings.
--    A fresh install has no retirement_settings rows and gets no profile —
--    normal onboarding creates one.
INSERT INTO "retirement_profiles" ("name", "description")
SELECT
	'Current Plan',
	'Your existing retirement assumptions, carried over when Retirement Profiles were introduced.'
WHERE EXISTS (SELECT 1 FROM "retirement_settings")
	AND NOT EXISTS (SELECT 1 FROM "retirement_profiles");--> statement-breakpoint

-- 2. Point every existing settings row at it.
UPDATE "retirement_settings"
SET "profile_id" = (SELECT MIN("id") FROM "retirement_profiles")
WHERE "profile_id" IS NULL
	AND EXISTS (SELECT 1 FROM "retirement_profiles");--> statement-breakpoint

-- 3. Per-person rows. COMPLETENESS INVARIANT: one row per person per profile.
--    A person with no retirement_settings row still gets one, populated from
--    the primary person's row — which is exactly what the engine's current
--    `ps?.retirementAge ?? settings.retirementAge` fallback resolves to, so
--    materialising it changes nothing today and lets step B delete that `??`.
--    end_age is per-person here (NOT MAX()) because the engine already reads
--    it per person and takes the max itself at projectionEndAge.
INSERT INTO "retirement_profile_people" (
	"profile_id", "person_id", "retirement_age", "end_age",
	"social_security_monthly", "ss_start_age", "rule_of_55_override",
	"salary_annual_increase"
)
SELECT
	(SELECT MIN("id") FROM "retirement_profiles"),
	p."id",
	COALESCE(own."retirement_age", prim."retirement_age"),
	COALESCE(own."end_age", prim."end_age"),
	COALESCE(own."social_security_monthly", prim."social_security_monthly"),
	COALESCE(own."ss_start_age", prim."ss_start_age"),
	COALESCE(own."rule_of_55_override", prim."rule_of_55_override"),
	COALESCE(own."salary_annual_increase", prim."salary_annual_increase")
FROM "people" p
LEFT JOIN "retirement_settings" own ON own."person_id" = p."id"
CROSS JOIN LATERAL (
	-- The "primary person"'s row, matching getPrimaryPerson()'s own rule:
	-- the person flagged is_primary_user, else the first person.
	SELECT rs.* FROM "retirement_settings" rs
	JOIN "people" pp ON pp."id" = rs."person_id"
	ORDER BY pp."is_primary_user" DESC, pp."id"
	LIMIT 1
) prim
WHERE EXISTS (SELECT 1 FROM "retirement_profiles")
	AND NOT EXISTS (SELECT 1 FROM "retirement_profile_people");--> statement-breakpoint

-- 4. Distribution tax rates, relocated off retirement_scenarios.
--    LEFT JOIN, so "no is_selected row" leaves these NULL rather than writing
--    a literal 0. Today's read is `selectedScenario ? rate : 0`, and step B
--    transcribes that as `rate != null ? rate : 0` — identical output, while
--    keeping "absent" distinguishable from a deliberate 0%.
--    MIN(id) among selected rows: today's read is an unordered SELECT with no
--    ORDER BY, so with several selected rows the winner is genuinely
--    nondeterministic in Postgres. There is no current behaviour to preserve;
--    this makes it deterministic.
UPDATE "retirement_settings" rs
SET
	"distribution_tax_rate_traditional" = sel."distribution_tax_rate_traditional",
	"distribution_tax_rate_roth" = sel."distribution_tax_rate_roth",
	"distribution_tax_rate_hsa" = sel."distribution_tax_rate_hsa",
	"distribution_tax_rate_brokerage" = sel."distribution_tax_rate_brokerage"
FROM (
	SELECT * FROM "retirement_scenarios"
	WHERE "is_selected" = true
	ORDER BY "id"
	LIMIT 1
) sel
WHERE rs."distribution_tax_rate_traditional" IS NULL;--> statement-breakpoint

-- 5. The global active profile. useEffectiveProfileId resolves
--    Plan's choice -> local selection -> THIS; without it a household with no
--    active Plan resolves to no profile and build-engine-payload returns null,
--    blanking the retirement page. scenarios.retirement_profile_id is
--    deliberately left NULL — backfilling it would turn "this Plan sets
--    nothing for retirement" into "sets profile 1" for every existing Plan.
INSERT INTO "app_settings" ("key", "value")
SELECT 'active_retirement_profile_id', to_jsonb((SELECT MIN("id") FROM "retirement_profiles"))
WHERE EXISTS (SELECT 1 FROM "retirement_profiles")
ON CONFLICT ("key") DO NOTHING;
