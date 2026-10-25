"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

/** Settings sections: the profile, money and calendar, payments, email and notifications. */
export function SettingsTabs({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";
  const base = `/dashboard/${slug}/settings`;
  const items = [
    { href: base, label: "Profile" },
    { href: `${base}/money`, label: "Money and year" },
    { href: `${base}/bookings`, label: "Bookings" },
    { href: `${base}/hours`, label: "Opening hours" },
    { href: `${base}/payments`, label: "Payments and tax" },
    { href: `${base}/email`, label: "Email" },
    { href: `${base}/notifications`, label: "Notifications" },
    { href: `${base}/integrations`, label: "Integrations" },
  ];
  return <NavTabs label="Settings sections" items={items.map((item) => ({ ...item, active: item.href === base ? pathname === base : pathname.startsWith(item.href) }))} />;
}
