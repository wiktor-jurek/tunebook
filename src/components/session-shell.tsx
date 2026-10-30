"use client";

import { trackEvent } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut, Monitor } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AppearancePicker } from "@/components/appearance-picker";
import { ModeSwitch } from "@/components/mode-switch";

// Session mode: the phone in the pub. No sidebar, no editing; the bottom deck (listening and the tabs, from the root
// layout so it keeps listening across pages) and an account sheet in the corner.
export function SessionShell({ children, switchable, userName }: { children: React.ReactNode; switchable: boolean; userName: string }) {
  const router = useRouter();
  return <div className="session-shell">
    <Dialog.Root>
      <Dialog.Trigger asChild><button type="button" className="session-account" aria-label={`Settings for ${userName}`}><span className="user-initial">{userName.charAt(0).toUpperCase()}</span></button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="session-sheet">
        <div className="session-sheet-grip" aria-hidden="true" />
        <Dialog.Title className="session-sheet-title">{userName}</Dialog.Title>
        <Dialog.Description className="sr-only">Appearance on this device and your account.</Dialog.Description>
        <p className="session-group-title">Appearance</p>
        <AppearancePicker />
        <ul className="session-group session-sheet-actions">
          {switchable && <li><ModeSwitch to="practice" className="session-row"><span className="session-row-emoji"><Monitor size={18} /></span><span className="session-row-text">Practice mode</span></ModeSwitch></li>}
          <li><button type="button" className="session-row session-danger" onClick={async () => { const result = await authClient.signOut(); trackEvent("signed_out", { outcome: result.error ? "error" : "success" }); router.push("/sign-in"); router.refresh(); }}><span className="session-row-emoji"><LogOut size={18} /></span><span className="session-row-text">Sign out</span></button></li>
        </ul>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    <main className="session-main">{children}</main>
  </div>;
}
