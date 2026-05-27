CREATE TABLE "access_control" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowed_email" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
