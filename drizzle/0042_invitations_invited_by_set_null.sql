-- P2 (audit 2026-04-17): change invitations.invited_by onDelete from CASCADE to SET NULL.
-- Preserves invitation audit trail when the inviter is deleted.

-- Drop the existing CASCADE FK (its generated name is invitations_invited_by_users_id_fk).
ALTER TABLE "invitations"
  DROP CONSTRAINT IF EXISTS "invitations_invited_by_users_id_fk";

-- Make the column nullable (previously NOT NULL).
ALTER TABLE "invitations"
  ALTER COLUMN "invited_by" DROP NOT NULL;

-- Re-add FK with SET NULL semantics.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_invited_by_users_id_fk"
  FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL;
