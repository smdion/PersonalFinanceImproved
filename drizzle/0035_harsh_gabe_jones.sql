CREATE TABLE "budget_item_category_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_item_id" integer NOT NULL,
	"service" text NOT NULL,
	"category_id" text NOT NULL,
	"category_name" text,
	"last_synced_at" timestamp with time zone,
	"sync_direction" text
);
--> statement-breakpoint
CREATE TABLE "savings_goal_category_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"savings_goal_id" integer NOT NULL,
	"service" text NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"category_id" text NOT NULL,
	"category_name" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "budget_item_category_links" ADD CONSTRAINT "budget_item_category_links_budget_item_id_budget_items_id_fk" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goal_category_links" ADD CONSTRAINT "savings_goal_category_links_savings_goal_id_savings_goals_id_fk" FOREIGN KEY ("savings_goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_item_category_links_budget_item_id_idx" ON "budget_item_category_links" USING btree ("budget_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_item_category_links_item_service_idx" ON "budget_item_category_links" USING btree ("budget_item_id","service");--> statement-breakpoint
CREATE INDEX "savings_goal_category_links_savings_goal_id_idx" ON "savings_goal_category_links" USING btree ("savings_goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "savings_goal_category_links_goal_service_role_idx" ON "savings_goal_category_links" USING btree ("savings_goal_id","service","role");