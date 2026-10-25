"use server";

import { staffAction } from "@/lib/actions/bookingContext";
import * as inputs from "@/lib/actions/repairInputs";
import * as technicians from "@/lib/repairs/technicians";

/** The technician directory (`repairs.manage`). */

export async function addExternalTechnician(input: unknown) {
  return staffAction(inputs.technicianSchema, input, "repairs.manage", async (data, ctx) => ({ technicianId: (await technicians.addExternalTechnician({ ...ctx, fields: data.fields })).id }));
}

export async function addStaffTechnician(input: unknown) {
  return staffAction(inputs.staffTechnicianSchema, input, "repairs.manage", async (data, ctx) => ({ technicianId: (await technicians.addStaffTechnician({ ...ctx, userId: data.userId, skills: data.skills })).id }));
}

export async function updateTechnician(input: unknown) {
  return staffAction(inputs.updateTechnicianSchema, input, "repairs.manage", async (data, ctx) => ({ technicianId: (await technicians.updateTechnician({ ...ctx, technicianId: data.technicianId, fields: data.fields, active: data.active })).id }));
}
