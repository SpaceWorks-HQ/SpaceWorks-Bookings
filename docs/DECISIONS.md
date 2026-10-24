# Decisions: Space Works Bookings

Every decision that shapes this repo, newest owner decisions first in each section. Do not re-open one without the
owner. Read this, then `CLAUDE.md` (same as `AGENTS.md`) and the build plan
`docs/plans/2026-10-23-bookings-build.md` (its "v2 amendments" override its earlier sections; where it and this
file disagree, this file wins). Money detail lives in `docs/PAYMENTS.md` and `docs/GST.md`, operations in
`docs/plans/ops-notes.md`.

## Where this repo fits

Space Works is a family of self-hosted, open-source (AGPL-3.0-or-later) tools for makerspaces and communities, in
the [SpaceWorks-HQ](https://github.com/SpaceWorks-HQ) GitHub org. On 2026-10-23 three areas of the original
[SpaceWorks](https://github.com/SpaceWorks-HQ/SpaceWorks) (Django + React) were split into standalone apps:
[SpaceWorks-Inventory](https://github.com/SpaceWorks-HQ/SpaceWorks-Inventory),
[SpaceWorks-Machines](https://github.com/SpaceWorks-HQ/SpaceWorks-Machines) and this one, space booking (rooms,
studios, desks, halls) with every payment and refund scenario. Siblings on the same stack, used as the reference for
structure, install and deploy: [SpaceWorks-Events](https://github.com/SpaceWorks-HQ/SpaceWorks-Events),
[SpaceWorks-Workspace](https://github.com/SpaceWorks-HQ/SpaceWorks-Workspace) and the Space Works membership platform
(see `NOTICE`). Brand and UI rules come only from [SpaceWorks-Design](https://spaceworks-hq.github.io/SpaceWorks-Design/).

## Owner decisions (2026-10-24)

1. **Roles.** There is no owner, space manager or treasurer role. The **bookings manager** is the top role and has
   full access: every setting (payments and providers, refund tiers, taxes, rules, hours, notifications, branding),
   the team, members, API keys and webhooks, the audit log, refunds, finance and reports, overrides, and deleting
   the makerspace. Ranks: bookings manager > front desk > viewer. Front desk takes bookings, checks people in and
   records payments taken at the desk; viewers read, with customer contact details hidden.
   - Whoever creates a makerspace, or is invited by a platform admin to run one, becomes its bookings manager.
   - Bookings managers manage everyone, other bookings managers included (invite, change role, remove).
   - A makerspace always keeps at least one bookings manager: removing, demoting or leaving as the last one is
     refused on the server, under a lock on the makerspace (`lib/teamManagers.ts`).
   - Migration `0005_manager_roles`: owners and space managers became bookings managers; **treasurers became
     viewers** (least privilege, since a treasurer was not a manager). A bookings manager can promote them again.
2. **Branches.** Only two long-lived branches: `dev` (integration) and `main` (production). No feature or phase
   branches are kept: work lands on `dev`, `dev` merges to `main`, and only @Shaan-Shoukath can push or merge to
   `main` (branch protection: push restricted to him, admins enforced, no force pushes or deletions; CODEOWNERS).
3. **Releases.** Pushes to `dev` publish gated test images (`dev` tag); merges to `main` publish the release images
   and the GitHub Release. The one-line VPS install (`curl -fsSL …/main/install.sh | bash`) installs from `main`.
4. **Standalone.** Every Space Works app is fully standalone: its own accounts and no runtime dependency on another
   app. Integration happens only through each app's REST API (API keys) and signed outbound webhooks.
5. **Build tooling.** The build was done by Claude Code; Codex (gpt-6.1-sol) wrote most of the Phase 1 actions and UI
   and reviewed them, and the rest (Phases 2 onwards) was built and reviewed by Claude Code alone.
6. **README.** It follows SpaceWorks-Events: banner, light screenshots, the one-line install and Render, with the
   Patch easter eggs and the Events light and dark circular reveal from the control that changed it.

## Original decisions (2026-10-23)

- **Stack:** Next.js 16 + React 19 + TypeScript, PostgreSQL 16 with Prisma, Auth.js, Tailwind 4 + Radix, Redis with
  a BullMQ `worker` and `beat`, S3-compatible private storage (Silo on a VPS), Vitest and Playwright. Domain logic is
  *ported* from the Django SpaceWorks code, not copied.
- **Multi-tenant:** one install runs several makerspaces; every tenant row and query is scoped to one, and
  cross-tenant access answers 404.
- **Own accounts per app** (email + password, magic link, TOTP for staff). No SSO.
- **Free and paid everywhere:** free instant, free with approval, paid upfront, deposit, pay later (*payment
  pending* with a due date), member vs public rates; Razorpay, Stripe, offline (cash, bank, UPI recorded by staff)
  or pay later, with refunds. Makerspace defaults, each overridable per space.
- **Nothing hardcoded:** settings areas gated by capabilities, with defaults, and a before/after audit row for every
  settings change. (Who holds which setting: see "Roles" above.)
- **Ship requirements:** a README with real Playwright screenshots (light and dark) in `docs/screenshots/`, the
  one-line VPS install and one-click cloud hosting (`render.yaml` + Deploy to Render).
- **Words:** a **makerspace** is the tenant; a **space** is a bookable room, studio, desk or hall inside one. Never
  call the tenant a "space" in code. There is no machine booking.
- **Refunds:** per-space policy tiers on customer cancellation, plus staff refunds and overrides with a reason;
  venue cancellation (everything back), reschedule, no-show, partial, failed or duplicate payments, late or
  out-of-order webhooks, refund retry, offline refunds.

## Build plan v2 amendments (2026-10-23, summary)

- **Concurrency:** one lock order (Booking → Payments by id → Refunds → DocumentCounter); occurrence inserts take a
  per-space advisory lock and allocate the lowest free unit; an exclusion constraint is the backstop.
- **Settings:** space overrides in one validated `ruleOverrides` JSON; `effectiveRules` reports each value's source;
  every settings write goes through `saveSetting` with an audited field diff.
- **Money:** no money before approval; charge modes FREE, PAY_NOW, DEPOSIT, PAY_LATER (+ `allowPayLater`);
  Payment and Refund rows are the ledger, with `paidMinor`/`refundedMinor` kept by triggers and `chargeMinor`
  written only by `recomputeCharge`; one obligation formula for every scenario; payment state is derived, never
  stored; a pure refund allocator (newest payment first, gateway before offline); the policy anchor is the
  earliest start a slot ever had.
- **Time:** opening hours may reach 24:00 and cross midnight; dated exceptions; DST rules; changing a timezone with
  future bookings is refused.
- **Other:** check-in uses its own signed code, never the manage link; per-occurrence ICS UIDs; recurring series
  cancel "this" or "this and following"; `quantity` books identical units.

## Defaults chosen conservatively (the owner may revisit)

- **GST documents for advances.** Booking payments get the existing tax invoice or receipt and refunds a credit
  note. Rule 50/51 receipt and refund vouchers for advances are not built (`docs/GST.md`); confirm with an
  accountant before going live under GST.
- **Overdue notices to staff** go to the customer (email) and the audit log, not team chat: a new chat event needs
  the chat events CHECK constraint widened (`lib/chat/events.ts`). The reconciliation page lists what needs
  attention.
- **Refunds beyond what is due are concessions** (`Booking.concessionMinor`): manual and provider-dashboard refunds
  above the refund due lower the charge, so the customer never owes them again.
- **Late arrival after a no-show.** Checking in someone already marked absent (while the slot was still held)
  restores the charge.
- **Treasurers became viewers** in the role migration (see "Roles").

## Deferred owner checks

Only the owner can run these; each is accepted when the right-hand column holds.

| Check | Accepted when |
| --- | --- |
| A real Render deploy from `render.yaml` | The Blueprint deploys; web, worker and beat are healthy; sign-in works; the questions in `docs/plans/ops-notes.md` "Not verifiable here" are answered |
| A real VPS install (`curl … install.sh \| bash`, the release path and `--ref dev`) | A fresh Ubuntu server installs, `scripts/status.sh` and the `ops` checks pass, and update, backup and restore work |
| GHCR images and a release install | The first tagged release publishes both images and the installer pulls them |
| Live Razorpay and Stripe in test mode | One booking paid and refunded through each gateway, with the webhook and the refund landing |
