CREATE TABLE "historical_salaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"salary" numeric(14, 2) NOT NULL,
	"bonus" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "historical_salaries" ADD CONSTRAINT "historical_salaries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "historical_salaries_person_year_idx" ON "historical_salaries" USING btree ("person_id","year");