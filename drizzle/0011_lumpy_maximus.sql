CREATE TABLE "asset_class_buckets" (
	"bucket" text PRIMARY KEY NOT NULL,
	"asset_class_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_class_buckets" ADD CONSTRAINT "asset_class_buckets_asset_class_id_asset_class_params_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_class_params"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_class_buckets_class_idx" ON "asset_class_buckets" USING btree ("asset_class_id");--> statement-breakpoint
-- Carry over each class's single bucket link (the old column stays, unused, for rollback).
INSERT INTO "asset_class_buckets" ("bucket", "asset_class_id") SELECT "composition_bucket", "id" FROM "asset_class_params" WHERE "composition_bucket" IS NOT NULL;
