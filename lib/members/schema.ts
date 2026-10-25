import { z } from "zod";
import { parseDateKey } from "@/lib/time/zoned";

export const memberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email").max(320)),
  name: z.string().trim().max(200).default(""),
  validUntil: z.string().refine((value) => parseDateKey(value) !== null, "Use a YYYY-MM-DD date").nullable().default(null),
  active: z.boolean().default(true),
  note: z.string().trim().max(500).default(""),
});
export type MemberInput = z.input<typeof memberSchema>;
