import { lookupVerification } from "@/lib/cards/verifyLookup";

/** A scanned card: what the public check page may show about it, read now. Rate limited in proxy.ts. */
export async function loadVerifyView({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const checkedAt = new Date();
  return { view: await lookupVerification(token, checkedAt), checkedAt };
}
