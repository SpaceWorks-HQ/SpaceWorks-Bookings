"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { loginErrorMessage, MfaStep } from "@/components/auth/MfaStep";
import { safeAuthRedirect } from "@/lib/authRedirect";

/**
 * Finish signing in with an emailed link. The token is read once and taken out of the address bar, then sent
 * only when the person presses the button, so mail scanners that open links can't use it up.
 */
export function MagicLinkSignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const [token] = useState(() => params.get("token") ?? "");
  const [callbackUrl] = useState(() => safeAuthRedirect(params.get("callbackUrl")));
  const [mfa, setMfa] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (window.location.search.includes("token=")) window.history.replaceState(null, "", "/login/magic");
  }, []);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setPending(true);
    setError(null);
    let result;
    try {
      result = await signIn("magic-link", { token, ...(mfa ? { totp: code } : {}), redirect: false });
    } catch {
      setPending(false);
      setError("Sign-in is temporarily unavailable. Refresh the page and try again.");
      return;
    }
    setPending(false);
    if (result?.error) {
      if (result.code === "mfa_required") {
        setMfa(true);
        return;
      }
      setError(mfa && result.code !== "address_blocked" && result.code !== "magic_link_invalid" ? "Invalid authenticator or recovery code." : loginErrorMessage(result.code ?? "magic_link_invalid"));
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  if (!token) {
    return <Callout tone="warning" title="This link is incomplete">Open the link from your email again, or <Link href="/login" className="underline underline-offset-4">ask for a new one</Link>.</Callout>;
  }
  if (mfa) {
    return (
      <MfaStep
        email="your account"
        code={code}
        onCodeChange={setCode}
        error={error}
        verifying={pending}
        disabled={pending}
        onSubmit={submit}
        onUseDifferentAccount={() => router.push("/login")}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-display-m text-ink">Sign in</h1>
        <p className="text-body-ui text-ink-secondary">Continue to sign in with the link we emailed you. It works once, for 15 minutes.</p>
      </div>
      {error ? <Callout tone="danger" role="alert">{error} <Link href="/login" className="underline underline-offset-4">Back to sign in</Link></Callout> : null}
      <Button variant="primary" size="lg" fullWidth loading={pending} onClick={() => void submit()}>Continue signing in</Button>
    </div>
  );
}
