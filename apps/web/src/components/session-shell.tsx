"use client";

import { trackEvent } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AppearancePicker } from "@/components/appearance-picker";
import { SiteCredits } from "@/components/site-footer";

const Account = createContext<{ userName: string; open: () => void } | null>(null);

/** The account button for a session-mode screen's title row: it opens the account sheet. Outside session mode, nothing. */
export function AccountButton() {
  const account = useContext(Account);
  if (!account) return null;
  return <button type="button" className="session-account" aria-label={`Settings for ${account.userName}`} onClick={account.open}><span className="user-initial">{account.userName.charAt(0).toUpperCase()}</span></button>;
}

// Session mode: the phone in the pub. No sidebar, no editing; the bottom deck (listening and the tabs, from the root
// layout so it keeps listening across pages) and an account sheet, opened from each top-level screen's title row.
export function SessionShell({ children, userName }: { children: React.ReactNode; userName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return <Account.Provider value={{ userName, open: () => setOpen(true) }}><div className="session-shell">
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="session-sheet">
        <div className="session-sheet-grip" aria-hidden="true" />
        <Dialog.Title className="session-sheet-title">{userName}</Dialog.Title>
        <Dialog.Description className="sr-only">Appearance on this device and your account.</Dialog.Description>
        <p className="session-group-title">Appearance</p>
        <AppearancePicker />
        <ul className="session-group session-sheet-actions">
          <li><button type="button" className="session-row session-danger" onClick={async () => { const result = await authClient.signOut(); trackEvent("signed_out", { outcome: result.error ? "error" : "success" }); router.push("/sign-in"); router.refresh(); }}><span className="session-row-emoji"><LogOut size={18} /></span><span className="session-row-text">Sign out</span></button></li>
        </ul>
        <SiteCredits />
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    <main className="session-main">{children}</main>
  </div></Account.Provider>;
}
