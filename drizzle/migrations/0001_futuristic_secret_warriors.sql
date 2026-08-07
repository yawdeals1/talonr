ALTER TABLE "users" ADD COLUMN "deploro_account_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deploro_account_id_unique" UNIQUE("deploro_account_id");