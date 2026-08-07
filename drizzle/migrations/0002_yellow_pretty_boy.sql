ALTER TABLE "users" ALTER COLUMN "deploro_account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";