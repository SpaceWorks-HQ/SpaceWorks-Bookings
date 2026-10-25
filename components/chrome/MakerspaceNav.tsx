"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShellMakerspace } from "@/lib/appShell";
import { can, makerspaceAllows, type Capability } from "@/lib/permissionRoles";
import { useRememberedOpen } from "@/components/ui/collapsible";

type Item = { path: string; label: string; capability: Capability; exact?: boolean };

/** Makerspace navigation in labelled groups, in order. Each entry shows only when the role has the capability. */
const GROUPS: Array<{ key: string; label: string; items: Item[] }> = [
  { key: "bookings", label: "Bookings", items: [
    { path: "", label: "Overview", capability: "makerspace.view", exact: true },
    { path: "/bookings", label: "Bookings", capability: "bookings.view" },
    { path: "/today", label: "Today", capability: "bookings.view" },
    { path: "/calendar", label: "Calendar", capability: "bookings.view" },
  ] },
  { key: "spaces", label: "Spaces", items: [
    { path: "/spaces", label: "Spaces", capability: "spaces.manage" },
    { path: "/members", label: "Members", capability: "members.manage" },
    { path: "/issues", label: "Issues", capability: "issues.view" },
    { path: "/issues", label: "My repairs", capability: "repairs.work" },
    { path: "/technicians", label: "Technicians", capability: "repairs.manage" },
  ] },
  { key: "money", label: "Money and reports", items: [
    { path: "/payments", label: "Payments", capability: "payments.view" },
    { path: "/finance", label: "Finance", capability: "finance.view" },
    { path: "/reports", label: "Reports", capability: "reports.view" },
  ] },
  { key: "admin", label: "Makerspace", items: [
    { path: "/team", label: "Team", capability: "makerspace.view" },
    { path: "/audit", label: "Audit log", capability: "audit.view" },
    { path: "/settings", label: "Settings", capability: "makerspace.settings" },
  ] },
];

export function NavItem({ href, children, active, onNavigate, badge }: { href: string; children: string; active: boolean; onNavigate?: () => void; badge?: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Text-only navigation (brand D9); 44px targets; pills (owner decision J1).
        "relative flex min-h-11 items-center gap-2.5 rounded-control px-4 text-[15px] text-ink transition-colors duration-[120ms] hover:bg-sidebar-hover",
        active && "bg-sidebar-active font-semibold text-on-sidebar-active hover:bg-sidebar-active",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </Link>
  );
}

/** One folding group: the group holding the current page is always open; other groups remember their choice. */
function NavGroup({ groupKey, label, current, children }: { groupKey: string; label: string; current: boolean; children: ReactNode }) {
  const [remembered, setOpen] = useRememberedOpen(`swb:nav:${groupKey}`, true);
  const open = current || remembered;
  const listId = useId();
  return (
    <div className="flex flex-col gap-1">
      <button type="button" aria-expanded={open} aria-controls={listId} disabled={current} onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center justify-between rounded-control px-4 text-overline text-ink-muted transition-colors hover:text-ink disabled:cursor-default disabled:hover:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--sw-ui-focus))]">
        {label}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div id={listId} hidden={!open} className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export function MakerspaceNav({ current, pathname, onNavigate }: { current: ShellMakerspace; pathname: string; onNavigate?: () => void }) {
  const base = `/dashboard/${current.slug}`;
  const isActive = (item: Item) => {
    const href = `${base}${item.path}`;
    return item.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };
  return <>
    {GROUPS.map((group) => {
      const items = group.items.filter((item) => makerspaceAllows(current.status, item.capability) && can(current.role, item.capability));
      if (items.length === 0) return null;
      return <NavGroup key={group.key} groupKey={group.key} label={group.label} current={items.some(isActive)}>
        {items.map((item) => <NavItem key={`${item.path}-${item.label}`} href={`${base}${item.path}`} active={isActive(item)} onNavigate={onNavigate}>{item.label}</NavItem>)}
      </NavGroup>;
    })}
  </>;
}
