ALTER TABLE "contribution_limits" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_limits" ADD COLUMN IF NOT EXISTS "source_version" integer;--> statement-breakpoint
ALTER TABLE "contribution_limits" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fpl_by_household" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "fpl_by_household" ADD COLUMN IF NOT EXISTS "source_version" integer;--> statement-breakpoint
ALTER TABLE "fpl_by_household" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "irmaa_brackets" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "irmaa_brackets" ADD COLUMN IF NOT EXISTS "source_version" integer;--> statement-breakpoint
ALTER TABLE "irmaa_brackets" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ltcg_brackets" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "ltcg_brackets" ADD COLUMN IF NOT EXISTS "source_version" integer;--> statement-breakpoint
ALTER TABLE "ltcg_brackets" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tax_brackets" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_brackets" ADD COLUMN IF NOT EXISTS "source_version" integer;--> statement-breakpoint
ALTER TABLE "tax_brackets" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;