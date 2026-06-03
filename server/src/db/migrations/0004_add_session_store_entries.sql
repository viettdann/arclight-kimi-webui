CREATE TABLE "session_store_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"sdk_session_id" text NOT NULL,
	"subpath" text,
	"entry" jsonb NOT NULL,
	"entry_uuid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "session_store_entries_load_idx" ON "session_store_entries" USING btree ("sdk_session_id","subpath","id");--> statement-breakpoint
CREATE INDEX "session_store_entries_list_idx" ON "session_store_entries" USING btree ("project_key","sdk_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_store_entries_idem_idx" ON "session_store_entries" USING btree ("project_key","sdk_session_id",coalesce("subpath", ''),"entry_uuid") WHERE "session_store_entries"."entry_uuid" IS NOT NULL;