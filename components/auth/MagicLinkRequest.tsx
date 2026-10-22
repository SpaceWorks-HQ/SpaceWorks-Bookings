"use client";

import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { requestMagicLink } from "@/app/actions/magic-link";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

/** "Email me a sign-in link": a small form under the password sign-in. The answer never says if an account exists. */
export function MagicLinkRequest({ initialEmail, disabled }: { initialEmail: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="quiet" className="self-center" disabled={disabled} onClick={() => { setEmail(initialEmail); setOpen(true); }}>
        <Mail aria-hidden className="size-4" />
        Email me a sign-in link
      </Button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setState(null);
    try {
      const result = await requestMagicLink({ email });
      setState(result.ok
        ? { tone: "success", text: "If there's an account for that address, a sign-in link is on its way. It works once, for 15 minutes." }
        : { tone: "danger", text: result.error });
    } catch {
      setState({ tone: "danger", text: "Email delivery is temporarily unavailable. Try again shortly." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4" onSubmit={submit} aria-label="Email me a sign-in link">
      {state ? <Callout tone={state.tone} role={state.tone === "danger" ? "alert" : "status"}>{state.text}</Callout> : null}
      <Field label="Email for the sign-in link" required>
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" loading={pending} disabled={!email || disabled}>Send the link</Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Use my password</Button>
      </div>
    </form>
  );
}
