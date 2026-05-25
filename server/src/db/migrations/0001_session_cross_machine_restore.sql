-- Wipe existing rows so the NOT NULL `projectName` add succeeds without backfill.
TRUNCATE TABLE "sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "projectName" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "session_files" DROP COLUMN "workDirHash";
