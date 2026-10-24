"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { selfCheckIn } from "@/app/actions/bookings-public";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";

type Access = { makerspaceSlug: string; bookingId?: string; manageToken?: string };

export function CheckInCode({ code, selfAccess }: { code: string; selfAccess?: Access }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <section className="flex flex-col items-start gap-3"><h2 className="text-h2">Check-in code</h2><p>Show this code to the makerspace team when you arrive.</p>
    <code className="break-all text-h3">{code}</code><div className="rounded-xl bg-white p-4"><QRCode value={code} size={160} title={`Check-in code ${code}`} /></div>
    {selfAccess ? <><p>You can also check yourself in now.</p>
      <Button disabled={pending} onClick={() => startTransition(async () => {
        setError("");
        try {
          const result = await selfCheckIn(selfAccess);
          if (result.ok) router.refresh(); else setError(result.error);
        } catch { setError("Could not check you in. Please try again."); }
      })}>Check in now</Button>
      {error ? <Callout role="alert" tone="danger">{error}</Callout> : null}</> : null}
  </section>;
}
