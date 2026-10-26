CREATE TABLE IF NOT EXISTS "tax_data_updates" (
	"data_version" integer PRIMARY KEY NOT NULL,
	"file_text" text NOT NULL,
	"signature" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone
);
