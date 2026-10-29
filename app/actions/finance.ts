"use server";

import { staffAction } from "@/lib/actions/bookingContext";
import * as inputs from "@/lib/actions/repairInputs";
import { postManualEntry, reverseEntry } from "@/lib/finance/ledger";
import { prisma } from "@/lib/db";
import { resolveFinancialDate } from "@/lib/actions/financialDate";

/** Hand-posted ledger entries and reversals (`finance.manage`, bookings managers only). */

export async function postFinanceEntry(input: unknown) {
  return staffAction(inputs.manualEntrySchema, input, "finance.manage", async (data, ctx) => {
    const { timezone } = await prisma.makerspace.findUniqueOrThrow({ where: { id: ctx.makerspaceId }, select: { timezone: true } });
    return { entryId: (await postManualEntry({ ...ctx, ...data, occurredAt: resolveFinancialDate(data.occurredAt, timezone) })).id };
  });
}

export async function reverseFinanceEntry(input: unknown) {
  return staffAction(inputs.reverseEntrySchema, input, "finance.manage", async (data, ctx) => ({ entryId: (await reverseEntry({ ...ctx, entryId: data.entryId, reason: data.reason })).id }));
}
