-- AlterTable
ALTER TABLE "InstanceSetting" ADD COLUMN     "appleClientId" TEXT,
ADD COLUMN     "appleKeyId" TEXT,
ADD COLUMN     "applePrivateKeyEncrypted" TEXT,
ADD COLUMN     "appleTeamId" TEXT,
ADD COLUMN     "githubClientId" TEXT,
ADD COLUMN     "githubClientSecretEncrypted" TEXT;

