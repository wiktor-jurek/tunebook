"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SetDialog, type SetChoice, type SetTask } from "@/components/set-dialog";

type SetDetails = Omit<Extract<SetTask, { mode: "edit" | "delete" }>, "mode">;

/** A set's rarer actions, editing and deleting, kept in a More menu so playing it comes first. */
export function SetMenu({ set, choices }: { set: SetDetails; choices: SetChoice[] }) {
  const [task, setTask] = useState<SetTask | null>(null);
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`More for ${set.name}`} title="More"><MoreHorizontal size={17} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12}>
        <DropdownMenuItem onSelect={() => setTask({ mode: "edit", ...set })}><Pencil size={15} /><span>Edit set</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="dropdown-danger" onSelect={() => setTask({ mode: "delete", ...set })}><Trash2 size={15} /><span>Delete set</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {task && <SetDialog task={task} choices={choices} onClose={() => setTask(null)} />}
  </>;
}
