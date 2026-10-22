import "server-only";

import { prisma } from "@/lib/db";
import { toCsvRow } from "@/lib/csv";

/**
 * The membership part of a person's data export: their own member records in every organisation, found by
 * their verified email. Selects are explicit. Answers to admin-only questions and managers' notes are the
 * organisation's working records and stay out; the organisation answers a full access request directly.
 */

export const MEMBERSHIP_EXPORT_LIMIT = 200;

export async function loadMembershipExportSource(email: string) {
  const members = await prisma.member.findMany({
    where: { email: email.trim().toLowerCase(), anonymisedAt: null },
    orderBy: { createdAt: "asc" },
    take: MEMBERSHIP_EXPORT_LIMIT,
    select: {
      organisationId: true, memberNumber: true, name: true, email: true, phone: true, stateCode: true, gstin: true,
      isMinor: true, guardianName: true, guardianEmail: true, guardianPhone: true, fieldValues: true, createdAt: true,
      organisation: { select: { name: true, slug: true } },
      unit: { select: { name: true } },
      roles: { select: { isPrimary: true, role: { select: { name: true } } } },
      terms: {
        orderBy: { createdAt: "asc" },
        select: {
          status: true, kind: true, startsAt: true, endsAt: true, graceUntil: true, currency: true, priceMinor: true, joiningFeeMinor: true, createdAt: true,
          plan: { select: { name: true } },
          events: { orderBy: { effectiveAt: "asc" }, take: 100, select: { from: true, to: true, effectiveAt: true, cause: true } },
        },
      },
      consents: { orderBy: { grantedAt: "asc" }, select: { purpose: true, noticeVersion: true, grantedAt: true, withdrawnAt: true, byGuardian: true } },
      erasureRequests: { orderBy: { createdAt: "asc" }, select: { status: true, createdAt: true, decidedAt: true } },
      refundRequests: { orderBy: { createdAt: "asc" }, select: { status: true, reason: true, suggestedMinor: true, currency: true, createdAt: true, decidedAt: true, decisionNote: true } },
      payments: {
        orderBy: { createdAt: "asc" },
        take: 500,
        select: {
          status: true, provider: true, method: true, currency: true, amountMinor: true, createdAt: true, paidAt: true, utr: true,
          term: { select: { plan: { select: { name: true } } } },
          documents: { select: { kind: true, number: true, issuedAt: true, totalMinor: true } },
          refunds: { select: { status: true, amountMinor: true, createdAt: true, processedAt: true } },
        },
      },
    },
  });
  const hidden = await prisma.planField.findMany({
    where: { organisationId: { in: [...new Set(members.map((member) => member.organisationId))] }, adminOnly: true },
    select: { organisationId: true, key: true },
  });
  return members.map((member) => ({ ...member, hiddenKeys: hidden.filter((field) => field.organisationId === member.organisationId).map((field) => field.key) }));
}

export type MembershipExportSource = Awaited<ReturnType<typeof loadMembershipExportSource>>;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Allow-listed fields only; never spread a source row. */
export function buildMembershipExport(source: MembershipExportSource) {
  return source.map((member) => {
    const answers = Object.fromEntries(Object.entries((member.fieldValues ?? {}) as Record<string, unknown>).filter(([key]) => !member.hiddenKeys.includes(key)));
    return {
      organisation: member.organisation.name,
      organisationSlug: member.organisation.slug,
      memberNumber: member.memberNumber,
      name: member.name,
      email: member.email,
      phone: member.phone,
      state: member.stateCode,
      gstin: member.gstin,
      unit: member.unit?.name ?? null,
      roles: member.roles.map((assignment) => ({ name: assignment.role.name, primary: assignment.isPrimary })),
      minor: member.isMinor,
      guardian: member.isMinor ? { name: member.guardianName, email: member.guardianEmail, phone: member.guardianPhone } : null,
      answers,
      memberSince: member.createdAt.toISOString(),
      terms: member.terms.map((term) => ({
        plan: term.plan.name,
        kind: term.kind,
        status: term.status,
        startsAt: iso(term.startsAt),
        endsAt: iso(term.endsAt),
        graceUntil: iso(term.graceUntil),
        currency: term.currency,
        priceMinor: term.priceMinor,
        joiningFeeMinor: term.joiningFeeMinor,
        openedAt: term.createdAt.toISOString(),
        history: term.events.map((event) => ({ from: event.from, to: event.to, at: event.effectiveAt.toISOString(), cause: event.cause })),
      })),
      consents: member.consents.map((consent) => ({ purpose: consent.purpose, noticeVersion: consent.noticeVersion, grantedAt: consent.grantedAt.toISOString(), withdrawnAt: iso(consent.withdrawnAt), byGuardian: consent.byGuardian })),
      erasureRequests: member.erasureRequests.map((request) => ({ status: request.status, requestedAt: request.createdAt.toISOString(), decidedAt: iso(request.decidedAt) })),
      refundRequests: member.refundRequests.map((request) => ({ status: request.status, reason: request.reason, offeredMinor: request.suggestedMinor, currency: request.currency, requestedAt: request.createdAt.toISOString(), decidedAt: iso(request.decidedAt), note: request.decisionNote })),
      payments: member.payments.map((payment) => ({
        plan: payment.term?.plan.name ?? null,
        status: payment.status,
        provider: payment.provider,
        method: payment.method,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        startedAt: payment.createdAt.toISOString(),
        paidAt: iso(payment.paidAt),
        reference: payment.utr,
        documents: payment.documents.map((document) => ({ kind: document.kind, number: document.number, issuedAt: document.issuedAt.toISOString(), totalMinor: document.totalMinor })),
        refunds: payment.refunds.map((refund) => ({ status: refund.status, amountMinor: refund.amountMinor, requestedAt: refund.createdAt.toISOString(), processedAt: iso(refund.processedAt) })),
      })),
    };
  });
}

export type MembershipExport = ReturnType<typeof buildMembershipExport>;

const HEADER = ["Organisation", "Member number", "Name", "Email", "Phone", "State", "Unit", "Plan", "Kind", "Status", "Starts", "Ends", "Currency", "Price (minor units)", "Joining fee (minor units)", "Opened"];

/** One row per membership term (a row with empty term cells for a member with none), for spreadsheets. */
export function membershipExportCsv(rows: MembershipExport): string {
  const lines = [toCsvRow(HEADER)];
  for (const member of rows) {
    const person = [member.organisation, member.memberNumber, member.name, member.email, member.phone ?? "", member.state ?? "", member.unit ?? ""];
    if (member.terms.length === 0) lines.push(toCsvRow([...person, "", "", "", "", "", "", "", "", ""]));
    for (const term of member.terms) {
      lines.push(toCsvRow([...person, term.plan, term.kind, term.status, term.startsAt ?? "", term.endsAt ?? "", term.currency, term.priceMinor, term.joiningFeeMinor, term.openedAt]));
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
