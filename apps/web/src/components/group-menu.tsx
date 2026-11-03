"use client";

import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GROUP_BYS, GROUP_BY_LABELS, GROUP_BY_SHORT, setGroupBy, useGroupBy } from "@/lib/tune-groups";

/** A quiet button by a list's title that says how it is grouped, and opens a menu of the other ways, the current one ticked. */
export function GroupMenu() {
  const groupBy = useGroupBy();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="group-menu-button" aria-label={`Grouped by ${GROUP_BY_LABELS[groupBy].toLowerCase()}. Change grouping`}>{GROUP_BY_SHORT[groupBy]}<ChevronDown size={15} aria-hidden="true" /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" collisionPadding={12}>
      <DropdownMenuLabel>Group by</DropdownMenuLabel>
      {GROUP_BYS.map((entry) => <DropdownMenuCheckboxItem key={entry} checked={groupBy === entry} onCheckedChange={() => setGroupBy(entry)}>{GROUP_BY_LABELS[entry]}</DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
