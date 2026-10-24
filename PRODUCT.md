# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Makerspace staff:** owners, space managers, bookings managers, front desk and treasurers of Indian makerspaces
  and shared workshops. They take bookings for rooms, studios, desks and halls by hand today (WhatsApp, shared
  calendars, UPI screenshots, paper receipts) and want one calm place to publish spaces, approve requests, take
  payments, check people in and handle refunds.
- **Bookers:** members of the makerspace and the public, who book a space as a guest or with an account, pay now,
  pay a deposit or pay later, and manage or cancel their booking.
- **Self-hosters:** the developer or IT volunteer a makerspace forwards the link to, who decides whether to install it
  on a VPS or a cloud stack.
- **Platform operators:** run an instance, review makerspaces that apply, and keep it healthy.

## Product Purpose
A self-hostable, multi-tenant platform for booking a makerspace's spaces: availability and opening hours, holds and
approvals, free or paid bookings (Razorpay, Stripe, offline, deposits and pay later), member and public rates, gapless
GST receipts, refunds that follow the makerspace's policy, and reports. Success is a makerspace that stops juggling
double-booked rooms and payment screenshots.

## Positioning
Open source (AGPL-3.0-or-later) and self-hostable, built for Indian makerspaces first: GST-correct receipts,
UPI-friendly offline payments with maker-checker confirmation and the April–March financial year. One instance hosts
many makerspaces, each reviewed before it opens. It stands alone (its own accounts, API and webhooks) so other Space
Works apps can be linked later.

## Operating Context
- Makerspaces apply at `/start`; a platform admin approves, asks for changes or declines. Platform admins can also set
  a makerspace up directly and invite its owner.
- Team roles: owner, space manager, bookings manager, front desk, treasurer, viewer (`lib/permissionRoles.ts`).
- People sign in with a password or an emailed one-time link; staff also need an authenticator app. No single sign-on.
- Runs on a VPS (bundled Postgres, Redis, Silo storage) or a cloud stack, with a BullMQ worker and beat for
  background jobs.

## Capabilities and Constraints
- Spaces only: no machine or tool booking.
- Money is integer paise; receipts are never edited, only reversed by credit notes.
- Built in phases (`docs/plans/2026-10-23-bookings-build.md`): the platform first (Phase 0), then spaces, pricing,
  availability and the booking flow (Phase 1), payments and refunds (Phase 2), dashboard, reports, API and webhooks
  (Phase 3), operations and documentation (Phase 4).

## Brand Commitments
- Space Works brand and Space Works UX from SpaceWorks-Design are binding. Product name: "Space Works Bookings".
- Copy: sentence case, en-GB, buttons named after their action, no exclamation marks on errors.

## Evidence on Hand
- No customers, testimonials, usage numbers or benchmarks exist. Never invent them.
- Demonstration material uses sample data built around the owner and the SpaceWorks team, with **Tinkerspace** as the
  demo makerspace (`scripts/seed-demo.mjs`). Label it as a sample where a visitor could mistake it for real.
  - Shaan Shoukath, Systems Engineer
  - Abhiram NJ, Cloud Specialist
  - Abdul Samad MJ, Full Stack Developer
  - Midlaj C, Backend Engineer

## Product Principles
1. Calm over clever: someone at the front desk with a queue should finish the task.
2. Money is exact and auditable; nothing financial is silently changed.
3. A space is never booked twice: the database refuses overlaps.
4. Self-hosting is a first-class path, not an afterthought.

## Accessibility & Inclusion
- WCAG 2.2 AA in both themes; reduced motion respected everywhere.
- Gilroy Light body text stays at 16px minimum.
- Indian names, scripts and the ₹ sign render correctly.
