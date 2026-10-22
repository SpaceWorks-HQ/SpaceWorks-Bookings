import { requireSuperAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { INSTANCE_SETTINGS_ID } from "@/lib/instanceSettings";

export async function loadSuperAdminSettingsView() {
  await requireSuperAdmin();
  const settings = await prisma.instanceSetting.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
  const env = process.env;
  return {
    initial: {
      emailFrom: settings?.emailFrom ?? env.EMAIL_FROM ?? "",
      smtpService: settings?.smtpService ?? env.SMTP_SERVICE ?? "",
      smtpHost: settings?.smtpHost ?? env.SMTP_HOST ?? "",
      smtpPort: String(settings?.smtpPort ?? env.SMTP_PORT ?? "587"),
      smtpSecure: settings?.smtpSecure ?? env.SMTP_SECURE === "true",
      smtpUser: settings?.smtpUser ?? env.SMTP_USER ?? "",
      smtpAllowUnauthenticated: settings?.smtpAllowUnauthenticated ?? env.SMTP_ALLOW_UNAUTHENTICATED === "1",
      backupProvider: settings?.backupProvider ?? env.BACKUP_PROVIDER ?? "",
      backupLastSuccessAt: settings?.backupLastSuccessAt ? settings.backupLastSuccessAt.toISOString().slice(0, 16) : "",
      backupRetentionDays: String(settings?.backupRetentionDays ?? env.BACKUP_RETENTION_DAYS ?? ""),
      hasSmtpPassword: Boolean(settings?.smtpPasswordEncrypted ?? env.SMTP_PASSWORD),
    },
    providers: {
      googleClientId: settings?.googleClientId ?? env.AUTH_GOOGLE_ID ?? "",
      githubClientId: settings?.githubClientId ?? env.AUTH_GITHUB_ID ?? "",
      appleClientId: settings?.appleClientId ?? env.AUTH_APPLE_ID ?? "",
      appleTeamId: settings?.appleTeamId ?? env.AUTH_APPLE_TEAM_ID ?? "",
      appleKeyId: settings?.appleKeyId ?? env.AUTH_APPLE_KEY_ID ?? "",
      hasGoogleSecret: Boolean(settings?.googleClientSecretEncrypted ?? env.AUTH_GOOGLE_SECRET),
      hasGithubSecret: Boolean(settings?.githubClientSecretEncrypted ?? env.AUTH_GITHUB_SECRET),
      hasAppleKey: Boolean(settings?.applePrivateKeyEncrypted ?? env.AUTH_APPLE_PRIVATE_KEY),
      callbackBase: (env.AUTH_URL ?? env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
    },
  };
}
