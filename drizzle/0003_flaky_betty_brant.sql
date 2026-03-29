CREATE TABLE "projection_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"override_type" text NOT NULL,
	"overrides" jsonb NOT NULL,
	"created_by" text,
	"updated_by" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projection_overrides_type_idx" ON "projection_overrides" USING btree ("override_type");
