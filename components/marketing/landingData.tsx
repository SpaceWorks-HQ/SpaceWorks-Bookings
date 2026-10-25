/** Content for the landing page: what the product does and the questions people ask. */
export const GITHUB = "https://github.com/SpaceWorks-Labs/SpaceWorks-Bookings";

export const FEATURES = [
  { title: "Rooms, studios, desks and halls", body: "Each space has its own hours, capacity, rates and rules, with sensible defaults for the whole makerspace." },
  { title: "Free or paid, your call", body: "Instant or approved bookings, pay now, a deposit or pay later. Razorpay, Stripe or offline, with GST receipts." },
  { title: "Refunds that follow your policy", body: "Cancellation tiers, staff overrides and partial refunds, each with a credit note and an audit trail." },
] as const;

export const FAQ = [
  {
    q: "What does it cost?",
    a: "The software is free and open source under the AGPL. If you host it yourself, you pay only for your server. Payment providers charge their usual fees on online payments.",
  },
  {
    q: "Do people need an account to book?",
    a: "No. Guests book with their email address, and a sign-in link lets them see and manage their bookings later.",
  },
  {
    q: "Which payments work?",
    a: "Razorpay and Stripe online, plus UPI, bank transfer and cash recorded by your team. Each makerspace picks the one online provider it uses.",
  },
  {
    q: "Are the receipts right for GST?",
    a: "Receipts follow GST rules for place of supply and rounding, with gapless numbers per financial year. Registered or not, check your setup with your chartered accountant.",
  },
  {
    q: "Who decides whether our makerspace can join this platform?",
    a: "The people who run this instance review every application before it opens, and email you their decision. If you host it yourself, that is you.",
  },
];
