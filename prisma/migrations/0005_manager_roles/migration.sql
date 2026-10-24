-- Owner decisions 2026-10-24 (docs/DECISIONS.md): there is no owner, space manager or treasurer role. The bookings
-- manager is the top role and takes over everything they could do: owners and space managers (members and pending
-- invites) become bookings managers; treasurers become viewers (least privilege; a manager can promote them).
-- Every makerspace keeps at least one bookings manager (lib/teamManagers.ts).
UPDATE "TeamMember" SET "role" = 'BOOKINGS_MANAGER' WHERE "role" IN ('OWNER', 'SPACE_MANAGER');
UPDATE "TeamInvite" SET "role" = 'BOOKINGS_MANAGER' WHERE "role" IN ('OWNER', 'SPACE_MANAGER');
UPDATE "TeamMember" SET "role" = 'VIEWER' WHERE "role" = 'TREASURER';
UPDATE "TeamInvite" SET "role" = 'VIEWER' WHERE "role" = 'TREASURER';

-- Postgres cannot drop enum values: recreate the type without them.
ALTER TYPE "TeamRole" RENAME TO "TeamRole_old";
CREATE TYPE "TeamRole" AS ENUM ('BOOKINGS_MANAGER', 'FRONT_DESK', 'VIEWER');
ALTER TABLE "TeamInvite" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "TeamInvite" ALTER COLUMN "role" TYPE "TeamRole" USING ("role"::text::"TeamRole");
ALTER TABLE "TeamInvite" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
ALTER TABLE "TeamMember" ALTER COLUMN "role" TYPE "TeamRole" USING ("role"::text::"TeamRole");
DROP TYPE "TeamRole_old";
