import { z } from "zod";
import { isReservedOrganisationSlug } from "@/lib/slug";
import { isUploadedImageUrl } from "@/lib/uploadUrl";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const organisationSlugSchema = z
  .string()
  .trim()
  .min(2, "The web address must be at least 2 characters")
  .max(64)
  .regex(slugRegex, "Use lowercase letters, numbers and single hyphens")
  .refine((slug) => !isReservedOrganisationSlug(slug), "That web address is reserved");

export const updateOrganisationSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().default(""),
  logoUrl: z
    .string()
    .refine(isUploadedImageUrl, "Invalid uploaded image URL")
    .or(z.literal("")),
});

/** Roles an owner or admin can hand out from the team page. Ownership never moves through this form. */
export const assignableTeamRoleSchema = z.enum(["ADMIN", "TREASURER", "VIEWER"]);

export const updateTeamRoleSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
  role: assignableTeamRoleSchema,
});

export const removeTeamMemberSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1),
});

export const createOrgInviteSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  role: assignableTeamRoleSchema.optional().default("VIEWER"),
});

export const revokeOrgInviteSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  inviteId: z.string().trim().min(1),
});

export const deleteOrganisationSchema = z.object({
  organisationSlug: z.string().trim().min(1),
});
