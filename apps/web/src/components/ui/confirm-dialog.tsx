"use client";

import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

// An in-app stand-in for window.confirm, for actions that cannot be undone.
export function ConfirmDialog({ open, title, description, action, busy = false, onConfirm, onOpenChange }: {
  open: boolean; title: string; description: string; action: string; busy?: boolean; onConfirm: () => void; onOpenChange: (open: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="dialog-content library-dialog" role="alertdialog" onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
      <header className="library-dialog-head"><div><Dialog.Title className="dialog-title">{title}</Dialog.Title><Dialog.Description className="library-dialog-description">{description}</Dialog.Description></div></header>
      <footer className="library-dialog-footer"><Dialog.Close asChild><Button ref={cancelRef} type="button" variant="outline" disabled={busy}>Cancel</Button></Dialog.Close><Button type="button" variant="danger" disabled={busy} onClick={onConfirm}>{action}</Button></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
