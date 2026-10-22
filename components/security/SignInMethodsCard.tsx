import { KeyRound, Link2 } from "lucide-react";
import { Chip } from "@/components/ui/display";
import { AccountCard } from "@/components/account/AccountCard";
import { signInProviderLabel } from "@/lib/accountSecurity";

/** Ways this account can sign in. Receives only a boolean and provider names. */
export function SignInMethodsCard({ hasPassword, providers }: { hasPassword: boolean; providers: string[] }) {
  return (
    <AccountCard id="sign-in-methods" title="Sign-in methods" description="The ways you can sign in to this account.">
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
        <li className="flex items-center gap-3 px-4 py-3">
          <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-ink-secondary [&_svg]:size-4"><KeyRound /></span>
          <div className="min-w-0 flex-1">
            <p className="text-label text-ink">Email and password</p>
            <p className="text-caption text-ink-muted">{hasPassword ? "You can sign in with your email address and password." : "No password set. Add one in the Password section above."}</p>
          </div>
          {hasPassword ? <Chip size="sm" tone="success">Set</Chip> : <Chip size="sm" tone="neutral">Not set</Chip>}
        </li>
        {providers.map((provider) => (
          <li key={provider} className="flex items-center gap-3 px-4 py-3">
            <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-ink-secondary [&_svg]:size-4"><Link2 /></span>
            <div className="min-w-0 flex-1">
              <p className="text-label text-ink">{signInProviderLabel(provider)}</p>
              <p className="text-caption text-ink-muted">Linked account. Its own security settings apply.</p>
            </div>
            <Chip size="sm" tone="success">Connected</Chip>
          </li>
        ))}
      </ul>
    </AccountCard>
  );
}
