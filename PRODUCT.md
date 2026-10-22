# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Makerspace office-bearers:** secretaries, treasurers and committee members of Indian clubs, associations, societies and alumni bodies. They run memberships by hand today (spreadsheets, UPI screenshots, paper receipts) and want a calm place to take members, collect fees, issue receipts and cards, and see who has lapsed.
- **Self-hosters:** the developer or IT volunteer a makerspace forwards the link to, who decides whether to install it on a VPS or a free cloud stack.
- **Members:** people who join, pay and renew, and carry a verifiable member card.
- **Platform operators:** run an instance, review makerspaces that apply, and keep it healthy.
- The landing page speaks to office-bearers and self-hosters equally (owner, 2026-10-19).

## Product Purpose
A self-hostable, multi-tenant platform for running a makerspace's memberships: plans for a period, join forms and approvals, renewals and reminders, payments (Razorpay, Stripe, offline), gapless GST receipts, member ID cards with QR verification, and reports for the platform, the makerspace and the member. Success is a makerspace that stops chasing renewals in spreadsheets.

## Positioning
Open source (AGPL-3.0-or-later) and self-hostable, built for Indian makerspaces first: GST-correct receipts, UPI-friendly offline payments with maker-checker confirmation, the April–March financial year, and units for makerspaces that run through districts, chapters or branches. One instance hosts many makerspaces, each reviewed before it opens.

## Operating Context
- Makerspaces apply at `/start`; a platform admin approves, asks for changes or declines. Platform admins can also set a makerspace up directly and invite its owner.
- Team roles: owner, admin, treasurer, viewer. Members manage their own memberships, payments, receipts and cards.
- Runs on a VPS (bundled Postgres, Redis, Silo storage) or a cloud stack, with releases and installer mirroring the main SpaceWorks repo.

## Capabilities and Constraints
- No events, RSVPs or check-in: this product is memberships only.
- Money is integer paise; receipts are never edited, only reversed by credit notes.
- Planned but not yet built at the time of writing: plans and members (P5), ID cards (P6), payments and GST documents (P7), member portal and customisable public makerspace pages (P8), reports (P9).

## Brand Commitments
- Space Works brand and Space Works UX from SpaceWorks-Design are binding. Product name: "Space Works Bookings".
- Copy: sentence case, en-GB, buttons named after their action, no exclamation marks on errors.

## Evidence on Hand
- No customers, testimonials, usage numbers or benchmarks exist. Never invent them.
- Demonstration material uses sample data built around the owner and the SpaceWorks team (owner, 2026-10-19), with **SpaceWorks** as the main sample makerspace and **Kunj-Company**, **Ideologists** and **Tinkerspace** as further sample makerspaces on the same instance. Label it as a sample where a visitor could mistake it for real.
  - Shaan Shoukath, Systems Engineer (the sample member the landing page follows)
  - Abhiram NJ, Cloud Specialist
  - Abdul Samad MJ, Full Stack Developer
  - Midlaj C, Backend Engineer
  - Ajzal P, Marketing Specialist
  - Anin Arafath, App Developer

## Product Principles
1. Calm over clever: an office-bearer with ten minutes should finish the task.
2. Money is exact and auditable; nothing financial is silently changed.
3. Members own their data: export, consent and erasure are first-class.
4. Self-hosting is a first-class path, not an afterthought.

## Accessibility & Inclusion
- WCAG 2.2 AA in both themes; reduced motion respected everywhere.
- Gilroy Light body text stays at 16px minimum.
- Indian names, scripts and the ₹ sign render correctly (Noto fallbacks in documents).
