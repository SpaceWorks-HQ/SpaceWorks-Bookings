"use client";

import { checkInByCode } from "@/app/actions/bookings-staff";
import { Card, CardHeader } from "@/components/ui/display";
import { ActionForm } from "./ActionForm";
import { TextField, text } from "./FormFields";

export function CheckInCodeForm({ slug }: { slug: string }) {
  return <Card><CardHeader title="Check in by code" description="Type the customer's check-in code or scan it with a keyboard scanner." />
    <ActionForm label="Check in by code" action={(data) => checkInByCode({ makerspaceSlug: slug, code: text(data, "code") })}>
      <TextField name="code" label="Check-in code" required />
    </ActionForm>
  </Card>;
}
