CREATE TABLE "project_git_metadata" (
	"user_id" text NOT NULL,
	"project_name" varchar(255) NOT NULL,
	"remote_url" text,
	"provider" varchar(32),
	"default_branch" varchar(255),
	"credential_id" uuid
);
--> statement-breakpoint
ALTER TABLE "project_git_metadata" ADD CONSTRAINT "project_git_metadata_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_git_metadata" ADD CONSTRAINT "project_git_metadata_credential_id_git_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."git_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_git_metadata_user_idx" ON "project_git_metadata" USING btree ("user_id");