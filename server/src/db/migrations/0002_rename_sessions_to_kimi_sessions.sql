ALTER TABLE "sessions" RENAME TO "kimi_sessions";--> statement-breakpoint
ALTER TABLE "session_files" RENAME TO "kimi_session_files";--> statement-breakpoint
ALTER INDEX "sessions_user_idx" RENAME TO "kimi_sessions_user_idx";--> statement-breakpoint
ALTER TABLE "kimi_sessions" RENAME CONSTRAINT "sessions_user_id_user_id_fk" TO "kimi_sessions_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "kimi_session_files" RENAME CONSTRAINT "session_files_sessionId_sessions_id_fk" TO "kimi_session_files_sessionId_kimi_sessions_id_fk";
