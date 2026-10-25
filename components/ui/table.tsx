import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Rounded (16px), bordered table with 48px rows that scrolls inside its own box on small screens (docs/DESIGN.md §4.8).
 * `sticky` is for long lists: from 1024px the box stops at about two-thirds of the window and the header row stays put.
 */
export function Table({ className, children, label, sticky = false, ...props }: HTMLAttributes<HTMLTableElement> & { label?: string; sticky?: boolean }) {
  return (
    <div className={cn("relative w-full overflow-x-auto rounded-xl border border-line bg-panel", sticky && "lg:max-h-[min(70vh,760px)] lg:overflow-y-auto")} role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      <table
        className={cn("w-full border-collapse text-left text-body-ui", sticky && "[&>thead]:sticky [&>thead]:top-0 [&>thead]:z-[1] [&>thead_th]:shadow-[inset_0_-1px_0_rgb(var(--sw-ui-line))]", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface", className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors duration-[120ms] hover:bg-subtle", className)} {...props} />;
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("h-12 whitespace-nowrap border-b border-line px-4 py-2 text-sm font-semibold text-accent-text", className)} {...props} />;
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("h-12 border-b border-line px-4 py-2.5 align-middle text-ink", className)} {...props} />;
}
