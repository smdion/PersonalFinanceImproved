-- Server-side cache for retirement projection results (deterministic
-- engine + Monte Carlo + Coast FIRE MC). See schema-pg.ts's projectionCache
-- doc comment for why this is a new table rather than reusing
-- budget_api_cache.
CREATE TABLE "projection_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"input_hash" text NOT NULL,
	"seed" integer,
	"result" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"engine_version" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projection_cache_hash_version_idx" ON "projection_cache" USING btree ("input_hash","engine_version");
--> statement-breakpoint
CREATE INDEX "projection_cache_expires_at_idx" ON "projection_cache" USING btree ("expires_at");
