"use client";

import { checkIn, markNoShow } from "@/app/actions/bookings-staff";
import { ActionForm } from "./ActionForm";

export function AttendanceActions({ slug, occurrenceId, noShow = false, canCheckIn = true, canNoShow = true }: {
  slug: string; occurrenceId: string; noShow?: boolean; canCheckIn?: boolean; canNoShow?: boolean;
}) {
  return <div className="flex flex-wrap gap-3">
    {canCheckIn ? <ActionForm label="Check in" action={() => checkIn({ makerspaceSlug: slug, occurrenceId })} /> : null}
    {!noShow && canNoShow ? <ActionForm label="Mark no-show" confirm="Mark everyone in this occurrence as a no-show? The space's no-show charge policy will apply." action={() => markNoShow({ makerspaceSlug: slug, occurrenceId })} /> : null}
  </div>;
}
