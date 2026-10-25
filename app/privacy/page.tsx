import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal information this Space Works Bookings site collects, why, who can see it, how long it is kept and the choices you have.",
};

const sections: LegalSection[] = [
  {
    id: "who-is-responsible",
    title: "Who is responsible",
    body: [
      "Space Works Bookings is open-source booking software from Space Works that anyone can run on their own server. In this policy, the “operator” is whoever runs this Space Works Bookings site, and “makerspaces” are the makerspaces, shared workshops and similar groups that offer their spaces for booking on it.",
      "The operator is responsible for accounts, security and the running of this site. Each makerspace is responsible for the information it asks people who book for and uses to run its bookings, such as booking details, payments and receipts. Depending on where you live, the law may call the operator and the makerspace a “controller” or a “data fiduciary” for that information.",
    ],
  },
  {
    id: "what-we-collect",
    title: "What we collect",
    body: [
      "Your account. Your name, email address, password if you set one (stored only as a one-way hash), profile picture if you add one, whether you have verified your email, your two-step verification settings and the browsers you have signed in from. If you sign in with an emailed link, the link is stored only as a one-way hash and works once, for 15 minutes.",
      "Your bookings. When you book a space, we store your name, email address, phone number if you give it, the space, the dates and times, the number of people and anything you tell the makerspace about the booking, and its status (for example requested, confirmed or cancelled).",
      "Payments and receipts. When you pay for a booking, we store your name and email address as the payer, your state for GST, the amount, what it was for, how you paid (online through the makerspace’s payment provider, or offline by cash, UPI, bank transfer or cheque), reference numbers such as a UPI transaction reference (UTR), and the receipts or tax invoices issued to you. Card and bank details are entered with the payment provider, not on this site, and are never stored here.",
      "Makerspaces and teams. For each makerspace we store its details, the people on its team and their roles, team invitations including any invited email address, and the platform’s review of its application.",
      "Uploads. Logos, profile pictures and photos of spaces are checked, resized and re-encoded, and hidden metadata such as camera details and location is removed before they are stored.",
      "Technical and security information. Your IP address is used briefly to limit repeated requests and prevent abuse. It is not stored in our database. We keep an activity log of important actions, such as sign-ins, approvals, role changes, settings changes, payments recorded, refunds and exports, recording who did what and when.",
    ],
  },
  {
    id: "how-we-use-it",
    title: "How we use it",
    body: [
      "We use this information to run the service: to create and secure your account, review makerspace applications, take and confirm bookings, take and record payments, issue receipts, tax invoices and credit notes, send booking emails and reminders, and investigate security or technical problems.",
      "We process it because it is needed to provide the service you asked for, because the law requires it (for example, keeping tax records), because you gave your consent (for example, to an optional question when you book), or because we and the makerspace have a legitimate interest in running bookings safely and accurately.",
    ],
  },
  {
    id: "who-can-see-it",
    title: "Who can see it",
    body: [
      "Makerspaces. People on a makerspace’s team can see its bookings and payments according to their role: bookings managers see everything; front desk see bookings, contact details and the payments they take; viewers see bookings with contact details hidden. Team members can export records they are allowed to see, and every export is logged.",
      "The public. Public makerspace pages show only what the makerspace publishes about itself and its spaces, never who has booked.",
      "Payment providers. If you pay online, the makerspace’s own payment provider (for example Razorpay or Stripe) processes the payment under its own privacy policy and receives the details it needs to do so.",
      "The operator. The operator’s administrators can see account and makerspace details to review applications, support makerspaces and protect the site. Opening a makerspace’s records is logged.",
    ],
  },
  {
    id: "other-services",
    title: "Other services we use",
    body: [
      "Email. Emails are sent through the operator’s email provider, which handles the recipient address and message to deliver them.",
      "Storage. Files may be stored with the operator’s storage provider in its configured region.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies and similar technology",
    body: "We use cookies only to keep you signed in, to protect forms against misuse and to remember your light or dark choice. We do not use advertising or tracking cookies.",
  },
  {
    id: "emails",
    title: "Emails we send",
    body: [
      "We send emails needed for the service: email verification, sign-in links and codes, password resets, team invitations, application decisions, booking confirmations, changes and reminders, payment receipts and refund notices.",
      "Booking emails are part of your booking. To stop receiving them, cancel the booking or contact the makerspace.",
    ],
  },
  {
    id: "makerspaces-duties",
    title: "If you run a makerspace",
    body: "Ask only for what you need to run your bookings, explain why you are asking, get consent for optional information, get a parent’s or guardian’s consent where children book, and limit who on your team can see contact details and payments.",
  },
  {
    id: "how-long-we-keep-it",
    title: "How long we keep it",
    body: [
      "Sign-in links expire after 15 minutes and sign-in codes after 10. Password-reset and email-verification links expire after one hour. Unused team invitations expire after seven days. Copies of sent emails are deleted after 30 days by default, and those containing sign-in or invitation links are deleted as soon as they are sent.",
      "Accounts and booking records are kept until they are deleted by you, the makerspace or the operator. Payment records, receipts and tax invoices are kept for at least eight years, because tax law requires it.",
      "Backups may hold copies of deleted information for a limited time, as set by the operator. Ask the operator about their retention schedule.",
    ],
  },
  {
    id: "security",
    title: "Security",
    body: "Passwords are hashed, payment provider keys are encrypted, two-step verification is available for every account and required for platform administrators, and every important change is logged. Sign-in, invitation and password-reset links work like keys, so do not share them. No system is perfectly secure. The operator is responsible for configuring its servers, backups and access securely, and for telling people about a data breach where the law requires it.",
  },
  {
    id: "your-choices-and-rights",
    title: "Your choices and rights",
    body: [
      "From your account you can update your profile, review your security settings and download your information. To have your account erased, contact the operator.",
      "Depending on where you live, including under India’s Digital Personal Data Protection Act, you may also have the right to access, correct, complete, update or erase your information, to withdraw consent as easily as you gave it, to nominate someone to act for you, to have a grievance addressed, and to complain to a data protection authority.",
      "For anything about a booking with a specific makerspace, contact that makerspace. For your account, contact the operator. They will respond as required by the laws that apply to them. We may need to confirm who you are first.",
    ],
  },
  {
    id: "children",
    title: "Children",
    body: "If you are below the age at which you can consent to the use of your personal information where you live, a parent or guardian must give consent for you when you book. Makerspaces that take bookings from children are responsible for obtaining any parental consent the law requires.",
  },
  {
    id: "international-transfers",
    title: "Where your information is stored",
    body: "Your information is stored where the operator hosts this site and its providers. If that is outside your country, the operator is responsible for protecting the transfer as the law requires.",
  },
  {
    id: "changes-to-this-policy",
    title: "Changes to this policy",
    body: "We may update this policy when the service or the way it handles information changes. The date at the top of this page shows when it last changed. If a change is significant, the operator will tell users where the law requires it.",
  },
  {
    id: "contact",
    title: "Contact",
    body: "For questions or requests about your information, contact the operator at [operator contact email — to be filled in by the operator], or its grievance officer at [grievance officer name and contact — to be filled in by the operator]. For anything about a particular booking, contact the makerspace shown on its page.",
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      title="Privacy"
      updated="23 October 2026"
      notice="This policy describes how Space Works Bookings handles personal information. Each operator must replace the bracketed placeholders with its own name and contact details, add its hosting, email, storage and payment providers, retention periods and the laws that apply to it, and should have it reviewed by a lawyer. It is not legal advice."
      sections={sections}
    />
  );
}
