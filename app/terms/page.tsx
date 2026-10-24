import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The rules for running a makerspace and booking its spaces on this Space Works Bookings site.",
};

const sections: LegalSection[] = [
  {
    id: "about-these-terms",
    title: "About these terms",
    body: [
      "These terms apply when you use this Space Works Bookings site, whether you create an account, run a makerspace, book a space or simply browse. By using it, you agree to them.",
      "Space Works Bookings is open-source software from Space Works. This site is run by [Operator legal name — to be filled in by the operator], called the “operator”. Spaces are offered by makerspaces, shared workshops and similar groups, called “makerspaces”. The operator runs the service. Each makerspace runs its own spaces and bookings.",
      "Makerspaces may add their own rules for their spaces, such as house rules or a code of conduct. Those rules apply to people who book with them alongside these terms.",
    ],
  },
  {
    id: "who-can-use-it",
    title: "Who can use Space Works Bookings",
    body: "You must be able to agree to these terms where you live. If you are under that age, a parent or guardian must agree for you, including when you book a space.",
  },
  {
    id: "your-account",
    title: "Your account",
    body: [
      "Keep your sign-in details secure and tell the operator if you think someone else has used your account. Use your real name and an email address you control.",
      "You are responsible for what happens through your account. We recommend turning on two-step verification, and it is required for platform administrators.",
    ],
  },
  {
    id: "makerspaces",
    title: "Running a makerspace",
    body: [
      "Makerspaces either apply and are reviewed by the operator, or are added by the operator directly. The operator may approve, ask for changes to, or decline an application, and may suspend or archive a makerspace that breaks these terms or the law.",
      "You are responsible for your makerspace and everything you publish or send through Space Works Bookings, including spaces, prices, opening hours, booking rules, approvals, receipts and emails. Keep your details accurate and tell people promptly if a booking or price changes.",
      "Owners decide who joins the team and what each person can do, and are responsible for their actions. Remove access promptly when someone leaves. Deleting a makerspace permanently deletes its settings and team, except records the law requires to be kept.",
    ],
  },
  {
    id: "bookings-and-payments",
    title: "Bookings and payments",
    body: [
      "When you book a space, you are dealing with the makerspace, not the operator. The makerspace decides who may book, its prices and opening hours, whether bookings need approval, and its cancellation and refund rules.",
      "Online payments go straight to the makerspace’s own account with its payment provider, such as Razorpay or Stripe, under that provider’s terms. The operator does not hold or handle bookers’ money. Offline payments are arranged directly with the makerspace, which records them here.",
      "Receipts and tax invoices are issued by the makerspace, in its name. Makerspaces are responsible for their own tax registration, the rates they charge and their filings. Space Works Bookings helps produce the documents but is not tax advice.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: [
      "Do not use Space Works Bookings to break the law, harass or harm others, publish hateful, misleading, sexually explicit or infringing content, or collect money under false pretences.",
      "Do not send spam or emails unrelated to a booking, collect bookers’ information for other purposes, try to access another makerspace’s data, get around security or rate limits, upload malware, overload the service, or scrape it.",
    ],
  },
  {
    id: "your-content",
    title: "Your content",
    body: "You keep ownership of what you upload or write. You give the operator permission to store, display and process it only as needed to run the service. Make sure you have the right to share it, including photos of your spaces.",
  },
  {
    id: "the-service",
    title: "The service",
    body: [
      "The operator works to keep the service available and secure but may change, pause or stop parts of it, for example for maintenance or updates.",
      "Space Works Bookings is open-source software licensed under the GNU Affero General Public License v3.0 or later. Its source code is available to anyone who uses it over a network.",
    ],
  },
  {
    id: "suspension-and-ending",
    title: "Suspension and ending",
    body: "You can stop using the service and ask for your account to be deleted at any time. The operator may suspend or close accounts or makerspaces that break these terms or the law, or that put others at risk. Records the law requires to be kept, such as receipts, are kept after closure.",
  },
  {
    id: "liability",
    title: "Disclaimers and liability",
    body: [
      "As far as the law allows, the operator gives no warranties about the service, and is not responsible for what makerspaces or the people who book with them do, for makerspaces’ prices, refunds or tax treatment, or for any indirect loss. The operator’s total liability is limited as far as the law allows.",
      "Nothing in these terms limits liability that the law does not allow to be limited, or removes rights you have as a consumer.",
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: "The operator may update these terms when the service or the law changes. The date at the top of this page shows when they last changed. Significant changes will be announced where reasonable. If you keep using Space Works Bookings after a change takes effect, you accept the updated terms.",
  },
  {
    id: "law-and-contact",
    title: "Governing law and contact",
    body: "These terms are governed by the laws of [governing law and jurisdiction — to be filled in by the operator], unless the law where you live gives you other rights. For questions about these terms, your account or the privacy policy, contact the operator at [operator contact email — to be filled in by the operator]. For questions about a particular booking, contact its makerspace.",
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      current="terms"
      title="Terms of use"
      updated="23 October 2026"
      notice="These terms are a starting point for any Space Works Bookings site. Each operator must replace the bracketed placeholders with its legal name, contact details and governing law, add how disputes are handled, and should have them reviewed by a lawyer. They are not legal advice."
      sections={sections}
    />
  );
}
