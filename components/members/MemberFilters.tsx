"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Dropdown, SearchInput } from "@/components/ui/field";

type Option = { id: string; name: string; level?: number };

/** Search and narrow the directory. Every choice lives in the address, so a filtered view can be shared. */
export function MemberFilters({ plans, units, roles, initial }: { plans: Option[]; units: Option[]; roles: Option[]; initial: { q: string; plan: string; unit: string; role: string } }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial.q);
  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    router.push(`?${next.toString()}`);
  };
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <form className="min-w-0 flex-1" role="search" onSubmit={(event) => { event.preventDefault(); go({ q }); }}>
        <SearchInput aria-label="Search members" placeholder="Search by name, email or number" value={q} onChange={(event) => setQ(event.target.value)} onClear={() => { setQ(""); go({ q: "" }); }} />
      </form>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-[38rem]">
        <Dropdown aria-label="Plan" value={initial.plan} onChange={(event) => go({ plan: event.target.value })}>
          <option value="">All plans</option>
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </Dropdown>
        {units.length ? (
          <Dropdown aria-label="Unit" value={initial.unit} onChange={(event) => go({ unit: event.target.value })}>
            <option value="">All units</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{`${"— ".repeat(unit.level ?? 0)}${unit.name}`}</option>)}
          </Dropdown>
        ) : <span className="hidden sm:block" />}
        {roles.length ? (
          <Dropdown aria-label="Role" value={initial.role} onChange={(event) => go({ role: event.target.value })}>
            <option value="">All roles</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </Dropdown>
        ) : null}
      </div>
    </div>
  );
}
