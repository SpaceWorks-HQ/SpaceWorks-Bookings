"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUpRight, ChevronsUpDown, Home, LogOut, Menu as MenuIcon, Moon, Plus, Sun, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShellMakerspace, ShellUser } from "@/lib/appShell";
import { ROLE_LABELS } from "@/lib/permissionRoles";
import { SpaceWorksProductLogo } from "@/components/brand/SpaceWorksLogo";
import { useAppColorMode } from "@/components/providers";
import { Avatar, MakerspaceLogo } from "@/components/ui/display";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { BrandHomeLink } from "./SiteHeader";
import { MakerspaceNav, NavItem } from "./MakerspaceNav";

function currentMakerspaceSlug(pathname: string | null) {
  const match = /^\/dashboard\/([^/]+)/.exec(pathname ?? "");
  if (!match || match[1] === "makerspace" || match[1] === "security") return null;
  return decodeURIComponent(match[1]!);
}

/** The person's menu: account, light/dark mode and sign out. */
function AccountMenu({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const { mode, toggleColorMode } = useAppColorMode();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const byPointer = useRef(false);
  const name = user.name ?? user.email ?? "Account";
  return (
    <Menu>
      <MenuTrigger
        ref={triggerRef}
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-line bg-panel p-2 text-left transition-colors hover:bg-surface data-[state=open]:bg-surface",
          pathname.startsWith("/account") && "ring-1 ring-line-strong",
        )}
      >
        <Avatar name={user.name ?? user.email} src={user.image} size="sm" className="size-8 text-[11px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{name}</span>
          {user.email && user.name ? <span className="block truncate text-caption text-ink-muted">{user.email}</span> : null}
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </MenuTrigger>
      <MenuContent
        side="top"
        align="start"
        className="min-w-[232px]"
        onPointerDown={() => { byPointer.current = true; }}
        onKeyDown={() => { byPointer.current = false; }}
        // Keyboard users get focus back on the trigger; a pointer choice doesn't light up a focus ring in the
        // middle of the colour switch.
        onCloseAutoFocus={(event) => { if (byPointer.current) event.preventDefault(); byPointer.current = false; }}
      >
        <MenuLabel>{name}</MenuLabel>
        <MenuItem asChild icon={<UserRound />}>
          <Link href="/account" onClick={onNavigate}>Account settings</Link>
        </MenuItem>
        <MenuItem
          icon={mode === "dark" ? <Sun /> : <Moon />}
          onSelect={() => {
            const rect = triggerRef.current?.getBoundingClientRect();
            const origin = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
            // Let the menu close first, so the snapshot of the old mode has no menu left in it.
            requestAnimationFrame(() => requestAnimationFrame(() => toggleColorMode(origin)));
          }}
        >
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => void signOut({ callbackUrl: "/" })}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function MakerspaceSwitcher({ current, makerspaces, onNavigate }: { current: ShellMakerspace; makerspaces: ShellMakerspace[]; onNavigate?: () => void }) {
  return (
    <Menu>
      <MenuTrigger className="group w-full overflow-hidden rounded-xl border border-line bg-panel text-left transition-colors hover:border-line-strong">
        <span className="flex min-h-[58px] items-center gap-2.5 px-2.5 py-2">
          <MakerspaceLogo name={current.name} src={current.logoUrl} size="md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">{current.name}</span>
            <span className="block text-caption text-ink-muted">{ROLE_LABELS[current.role]}</span>
          </span>
          <ChevronsUpDown aria-hidden className="mt-1 size-4 shrink-0 text-ink-muted" />
          <span className="sr-only">Switch makerspace</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" side="bottom" className="min-w-[240px]">
        <MenuLabel>Makerspaces</MenuLabel>
        {makerspaces.map((makerspace) => (
          <MenuItem key={makerspace.slug} asChild>
            <Link href={`/dashboard/${makerspace.slug}`} onClick={onNavigate}>
              <span className="flex items-center gap-2.5">
                <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="sm" />
                <span className="min-w-0 truncate">{makerspace.name}</span>
              </span>
            </Link>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem asChild icon={<Home />}>
          <Link href="/dashboard" onClick={onNavigate}>All makerspaces</Link>
        </MenuItem>
        <MenuItem asChild icon={<Plus />}>
          <Link href="/start" onClick={onNavigate}>Apply for a new makerspace</Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function SidebarContents({ user, makerspaces, onNavigate }: { user: ShellUser; makerspaces: ShellMakerspace[]; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const slug = currentMakerspaceSlug(pathname);
  const current = slug ? makerspaces.find((makerspace) => makerspace.slug === slug) ?? null : null;
  const base = current ? `/dashboard/${current.slug}` : "";
  const active = current?.status === "ACTIVE";

  return (
    <div className="flex min-h-full flex-col gap-4 px-3 py-3.5 [&>*]:shrink-0">
      <div className="pl-2 pt-1">
        <BrandHomeLink href="/dashboard" stacked />
      </div>

      {current ? (
        <>
          <MakerspaceSwitcher current={current} makerspaces={makerspaces} onNavigate={onNavigate} />
          <nav aria-label="Makerspace" className="flex flex-col gap-1">
            <MakerspaceNav current={current} pathname={pathname} onNavigate={onNavigate} />
            {active ? null : (
              // Under review, declined, suspended or archived: the status page explains what is open.
              <NavItem href={`${base}/application`} active={pathname.startsWith(`${base}/application`)} onNavigate={onNavigate}>
                {current.status === "SUSPENDED" || current.status === "ARCHIVED" ? "Status" : "Application"}
              </NavItem>
            )}
          </nav>
        </>
      ) : (
        <nav aria-label="Workspace" className="flex flex-col gap-1">
          <NavItem href="/dashboard" active={pathname === "/dashboard"} onNavigate={onNavigate}>Home</NavItem>
          <p className="mt-4 px-4 pb-0.5 text-overline text-ink-muted">Makerspaces</p>
          {makerspaces.map((makerspace) => (
            <Link
              key={makerspace.slug}
              href={`/dashboard/${makerspace.slug}`}
              onClick={onNavigate}
              className="relative flex min-h-11 items-center gap-2.5 rounded-control px-4 text-[15px] text-ink transition-colors hover:bg-sidebar-hover"
            >
              <MakerspaceLogo name={makerspace.name} src={makerspace.logoUrl} size="sm" className="size-6 rounded-[7px] text-[10px]" />
              <span className="min-w-0 flex-1 truncate">{makerspace.name}</span>
            </Link>
          ))}
          <NavItem href="/start" active={pathname === "/start"} onNavigate={onNavigate}>Apply for a makerspace</NavItem>
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {current && active ? (
          <Link
            href={`/m/${current.slug}`}
            onClick={onNavigate}
            className="inline-flex min-h-11 items-center gap-1 rounded-control px-4 text-sm font-medium text-ink underline-offset-4 hover:underline"
          >
            View public page
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        ) : null}
        <AccountMenu user={user} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/**
 * Dashboard app shell (docs/DESIGN.md): a 256px Citron sidebar with text-only navigation from 1024px,
 * and a top bar with a menu sheet below it. There is no icon rail: the navigation is words only.
 */
export function AppShell({ user, makerspaces, children }: { user: ShellUser; makerspaces: ShellMakerspace[]; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-[256px] shrink-0 overflow-y-auto overflow-x-hidden border-r border-line bg-sidebar lg:block">
        <SidebarContents user={user} makerspaces={makerspaces} />
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-canvas px-4 lg:hidden">
        <Link href="/dashboard" aria-label="Space Works Bookings home" className="inline-flex min-h-11 shrink-0 items-center rounded-md">
          <SpaceWorksProductLogo height={30} label={null} />
        </Link>
        <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogPrimitive.Trigger asChild>
            <IconButton label="Open navigation menu">
              <MenuIcon />
            </IconButton>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(var(--sw-color-ink)/0.48)] dark:bg-[rgb(0_0_0/0.48)]" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(280px,86vw)] overflow-y-auto border-r border-line bg-sidebar shadow-float focus:outline-none">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Dashboard navigation</DialogPrimitive.Description>
              <DialogPrimitive.Close asChild>
                <IconButton label="Close navigation menu" size="sm" className="absolute right-3 top-3 z-10">
                  <X />
                </IconButton>
              </DialogPrimitive.Close>
              <SidebarContents user={user} makerspaces={makerspaces} onNavigate={() => setMenuOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-9 lg:py-9">
        <div className="mx-auto w-full max-w-[1120px]">{children}</div>
      </main>
    </div>
  );
}
