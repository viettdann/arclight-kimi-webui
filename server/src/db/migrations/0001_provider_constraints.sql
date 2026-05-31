ALTER TABLE "provider_models" ADD CONSTRAINT "provider_models_provider_model_unique" UNIQUE("provider_id","model_id");--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_type_check" CHECK (type IN ('oauth', 'api'));--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_visibility_check" CHECK (visibility IS NULL OR visibility IN ('public', 'private'));--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_visibility_scope_check" CHECK ((owner_user_id IS NULL) = (visibility IS NOT NULL));