CREATE TABLE "kimi_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"defaults" jsonb NOT NULL,
	"provider" jsonb NOT NULL,
	"models" jsonb NOT NULL,
	"services" jsonb NOT NULL,
	"loop_control" jsonb NOT NULL,
	"background" jsonb NOT NULL,
	"notifications" jsonb NOT NULL,
	"mcp_client" jsonb NOT NULL,
	"hooks" jsonb NOT NULL,
	"extra_toml_override" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kimi_config_singleton" CHECK ("id" = 1)
);
