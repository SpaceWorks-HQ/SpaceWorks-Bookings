"use server";

import * as members from "@/lib/members/service";
import { staffAction } from "@/lib/actions/bookingContext";
import { upsertMemberSchema, removeMemberSchema, importMembersSchema } from "@/lib/actions/settingsInputs";

export async function upsertMember(input: unknown) {
  return staffAction(upsertMemberSchema, input, "members.manage", (data, ctx) => members.upsertMember({ ...ctx, member: data.member }));
}

export async function removeMember(input: unknown) {
  return staffAction(removeMemberSchema, input, "members.manage", (data, ctx) => members.removeMember({ ...ctx, memberId: data.memberId }));
}

export async function importMembersCsv(input: unknown) {
  return staffAction(importMembersSchema, input, "members.manage", (data, ctx) => members.importMembersCsv({ ...ctx, csv: data.csv }));
}
