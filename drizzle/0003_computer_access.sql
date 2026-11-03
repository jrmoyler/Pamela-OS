CREATE TABLE "computer_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"agent_key_id" uuid,
	"requested_by" text DEFAULT 'hermes' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"action" text NOT NULL,
	"detail" text,
	"url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ADD COLUMN "computer_policy" text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD COLUMN "computer_kinds" text[] DEFAULT '{"browser","computer","files"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD COLUMN "computer_trust_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "computer_tasks" ADD COLUMN "agent_key_id" uuid;--> statement-breakpoint
ALTER TABLE "computer_tasks" ADD COLUMN "approved_via" text;--> statement-breakpoint
ALTER TABLE "computer_tasks" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "computer_permissions" ADD CONSTRAINT "computer_permissions_task_id_computer_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."computer_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_permissions" ADD CONSTRAINT "computer_permissions_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "computer_permissions_status_idx" ON "computer_permissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "computer_permissions_task_idx" ON "computer_permissions" USING btree ("task_id");--> statement-breakpoint
ALTER TABLE "computer_tasks" ADD CONSTRAINT "computer_tasks_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE set null ON UPDATE no action;