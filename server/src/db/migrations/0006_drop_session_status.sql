DROP INDEX "kimi_sessions_user_idx";--> statement-breakpoint
CREATE INDEX "kimi_sessions_user_idx" ON "kimi_sessions" USING btree ("user_id","lastActiveAt" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "kimi_sessions" DROP COLUMN "status";