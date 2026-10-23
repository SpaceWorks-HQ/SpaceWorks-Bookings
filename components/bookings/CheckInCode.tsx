"use client";
import QRCode from "react-qr-code";

export function CheckInCode({ code }: { code: string }) {
  return <section className="flex flex-col items-start gap-3"><h2 className="text-h2">Check-in code</h2><p>Show this code to the makerspace team when you arrive.</p>
    <code className="break-all text-h3">{code}</code><div className="rounded-xl bg-white p-4"><QRCode value={code} size={160} title={`Check-in code ${code}`} /></div>
  </section>;
}
