/**
 * Contact-detail masking for roles without `bookings.contact` (VIEWER). Client-safe and deterministic:
 * enough is left to tell two people apart, never enough to reach them.
 */

/** "shaan@example.com" → "s•••@e•••.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}•••@${host.slice(0, 1)}•••${tld}`;
}

/** "+91 98470 12345" → "•••• 45". */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 2 ? `•••• ${digits.slice(-2)}` : "••••";
}

/** Apply the mask when the viewer may not see contact details. */
export function contactFor(showContact: boolean, person: { email: string; phone: string | null }): { email: string; phone: string } {
  return showContact ? { email: person.email, phone: person.phone ?? "" } : { email: maskEmail(person.email), phone: maskPhone(person.phone) };
}
