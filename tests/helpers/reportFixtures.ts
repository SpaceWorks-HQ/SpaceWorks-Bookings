import { prepareDataset, type ReportEvent, type ReportMember, type ReportTerm } from "@/lib/reports/dataset";
import type { TermKind, TermStatus } from "@/lib/membership/lifecycle";

/** Instants in IST: "2026-04-01" is 00:00 on 1 April in Asia/Kolkata. */
export const ist = (day: string, time = "00:00") => new Date(`${day}T${time}:00+05:30`);

export function member(id: string, extra: Partial<ReportMember> = {}): ReportMember {
  return { id, memberNumber: Number(id.replace(/\D/g, "")) || 1, name: id, unitId: null, unitPath: null, source: "JOIN_FORM", stateCode: "KL", hasPhone: true, hasPhoto: true, isMinor: false, hasGuardian: false, roleIds: [], createdAt: ist("2025-01-01"), ...extra };
}

type TermInput = { id: string; member: string; plan?: string; status: TermStatus; kind?: TermKind; starts?: string; ends?: string | null; grace?: string | null; renewedFrom?: string; created?: string };

export function term(input: TermInput): ReportTerm {
  return {
    id: input.id,
    memberId: input.member,
    planId: input.plan ?? "plan",
    status: input.status,
    kind: input.kind ?? (input.renewedFrom ? "RENEWAL" : "NEW"),
    startsAt: input.starts ? ist(input.starts) : null,
    endsAt: input.ends ? ist(input.ends) : null,
    graceUntil: input.grace ? ist(input.grace) : input.ends && input.grace !== null ? ist(input.ends) : null,
    renewedFromId: input.renewedFrom ?? null,
    createdAt: ist(input.created ?? input.starts ?? "2025-01-01"),
  };
}

export function event(termId: string, from: TermStatus | null, to: TermStatus, at: Date, cause = "test"): ReportEvent {
  return { termId, from, to, effectiveAt: at, cause };
}

/** A term activated (event) when it starts, plus any extra events. */
export function activated(t: ReportTerm, at?: Date): ReportEvent[] {
  return [event(t.id, null, "PENDING_PAYMENT", at ?? t.startsAt!, "applied"), event(t.id, "PENDING_PAYMENT", "ACTIVE", at ?? t.startsAt!, "paid")];
}

export function build(members: ReportMember[], terms: ReportTerm[], extraEvents: ReportEvent[] = []) {
  const events = [...terms.filter((t) => t.startsAt && t.status !== "PENDING_APPROVAL" && t.status !== "PENDING_PAYMENT").flatMap((t) => activated(t)), ...extraEvents];
  return prepareDataset({ members, terms, events });
}
