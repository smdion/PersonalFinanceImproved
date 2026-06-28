CREATE TABLE "utility_reading" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"usage" numeric(14, 4),
	"note" text
);
--> statement-breakpoint
CREATE TABLE "utility_service" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider_name" text NOT NULL,
	"usage_unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "utility_reading" ADD CONSTRAINT "utility_reading_service_id_utility_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."utility_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "utility_reading_service_year_month_idx" ON "utility_reading" USING btree ("service_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_service_kind_idx" ON "utility_service" USING btree ("kind");