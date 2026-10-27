CREATE TABLE "studio_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"graph" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"cover_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid,
	"node_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"model" text,
	"prompt" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "studio_flows" ADD CONSTRAINT "studio_flows_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_generations" ADD CONSTRAINT "studio_generations_flow_id_studio_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."studio_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_generations_flow_idx" ON "studio_generations" USING btree ("flow_id","node_id","created_at");