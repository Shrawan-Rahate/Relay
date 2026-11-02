-- Preserve existing users, sessions, memberships and all referenced records.
-- NULL identity IDs leave legacy accounts unlinked; never backfill by email.
ALTER TABLE "User" ADD COLUMN "supabaseUserId" UUID;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
