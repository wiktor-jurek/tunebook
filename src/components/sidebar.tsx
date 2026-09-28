"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Folder, Music2, LogOut, Plus, Search, Settings2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { ProfilePreferences } from "@/components/profile-preferences";
import type { getLibrary } from "@/lib/library";

type Library = Awaited<ReturnType<typeof getLibrary>>;
type FolderRow = Library["folders"][number];
type BookRow = Library["books"][number];
type Task = { operation: string; title: string; name?: string; folderId?: string | null; bookId?: string; parentId?: string | null; emoji?: string | null; danger?: boolean };
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

async function mutate(body: Record<string, unknown>) {
  const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not save changes");
}

export function Sidebar({ library, userName, defaultSound }: { library: Library; userName: string; defaultSound: number }) {
  const path = usePathname(), router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const foldersByParent = (parent: string | null) => library.folders.filter((f) => f.parentId === parent);
  const booksByFolder = (folder: string | null) => library.books.filter((b) => b.folderId === folder);
  const launch = (next: Task) => { setError(""); setPickerOpen(false); setTask(next); };
  const closeMobile = () => setMobileOpen(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await mutate({ ...task, name: data.get("name") || task.name, parentId: data.has("parentId") ? data.get("parentId") : task.parentId, folderId: data.has("folderId") ? data.get("folderId") : task.folderId });
      setTask(null); router.refresh();
      if (task.operation === "deleteBook" && path === `/books/${task.bookId}`) router.push("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }
  const bookLink = (book: BookRow) => <div key={book.id} className="nav-row"><Link onClick={closeMobile} className={`nav-link nav-book ${path === `/books/${book.id}` ? "active" : ""}`} href={`/books/${book.id}`}>{book.emoji ? <span className="book-emoji" aria-hidden="true">{book.emoji}</span> : <BookOpen size={15} />} <span>{book.name}</span></Link><button className="icon-button subtle" aria-label={`Manage ${book.name}`} onClick={() => launch({ operation: "renameBook", title: `Manage ${book.name}`, bookId: book.id, name: book.name, folderId: book.folderId, emoji: book.emoji })}><Settings2 size={14} /></button></div>;
  const creationRow = (folderId: string | null) => <div className="nav-create-row"><button className="nav-add" onClick={() => launch({ operation: "createBook", title: "New tunebook", folderId })}><Plus size={12} /> New tunebook</button><button className="nav-add" onClick={() => launch({ operation: "createFolder", title: "New folder", parentId: folderId })}><Plus size={12} /> New folder</button></div>;
  const renderFolder = (folder: FolderRow, depth: number): React.ReactNode => <div key={folder.id}>
    <div className="nav-row" style={{ paddingLeft: depth * 12 }}><button className="nav-link nav-folder" aria-expanded={open[folder.id] ?? true} onClick={() => setOpen({ ...open, [folder.id]: !(open[folder.id] ?? true) })}>{open[folder.id] ?? true ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Folder size={15} /><span>{folder.name}</span></button><button className="icon-button subtle" aria-label={`Manage ${folder.name}`} onClick={() => launch({ operation: "renameFolder", title: `Manage ${folder.name}`, folderId: folder.id, name: folder.name, parentId: folder.parentId })}><Settings2 size={14} /></button></div>
    {(open[folder.id] ?? true) && <div className="nav-children">{foldersByParent(folder.id).map((child) => renderFolder(child, depth + 1))}{booksByFolder(folder.id).map(bookLink)}{creationRow(folder.id)}</div>}
  </div>;
  return <>
    <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><BookOpen size={18} /> Tunebook</button>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-head"><Link href="/" className="brand" onClick={closeMobile}><span className="brand-mark">𝄞</span><span>Tunebook</span></Link><button className="icon-button mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={18} /></button></div>
      <nav aria-label="Main navigation">
        <div className="nav-section"><Link onClick={closeMobile} href="/" className={`nav-link ${path === "/" ? "active" : ""}`}><Music2 size={16} /> Tunes <span className="nav-count">{library.tunes.length}</span></Link><Link onClick={closeMobile} href="/import" className={`nav-link ${path === "/import" ? "active" : ""}`}><Search size={16} /> Import tunes</Link></div>
        <div className="nav-label-row"><span>TUNEBOOKS</span></div>
        <div>{booksByFolder(null).map(bookLink)}{foldersByParent(null).map((folder) => renderFolder(folder, 0))}</div>
        {creationRow(null)}
      </nav>
      <div className="sidebar-bottom"><ProfilePreferences userName={userName} defaultSound={defaultSound} /><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={async () => { await authClient.signOut(); router.push("/sign-in"); router.refresh(); }}><LogOut size={16} /></button></div>
    </aside>
    <Dialog.Root open={Boolean(task)} onOpenChange={(value) => { if (!value) setTask(null); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content"><Dialog.Title className="dialog-title">{task?.title}</Dialog.Title><Dialog.Description className="sr-only">Manage a folder or tunebook.</Dialog.Description><form onSubmit={submit}>
      {task?.operation.startsWith("create") || task?.operation.startsWith("rename") ? <label className="field-label">Name<Input name="name" defaultValue={task.name || ""} required maxLength={80} autoFocus /></label> : null}
      {(task?.operation === "createBook" || task?.operation === "renameBook") && <div className="field-label"><span>Icon</span><div className="emoji-choice"><button type="button" className="emoji-preview" aria-label="Choose tunebook emoji" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>{task.emoji || <BookOpen size={20} />}</button><Button type="button" variant="outline" onClick={() => setPickerOpen(!pickerOpen)}>{task.emoji ? "Change emoji" : "Choose emoji"}</Button>{task.emoji && <Button type="button" variant="ghost" onClick={() => { setTask({ ...task, emoji: null }); setPickerOpen(false); }}>Use book icon</Button>}</div>{pickerOpen && <div className="emoji-picker"><EmojiPicker width="100%" height={320} lazyLoadEmojis onEmojiClick={(emoji) => { setTask({ ...task, emoji: emoji.emoji }); setPickerOpen(false); }} /></div>}</div>}
      {task?.operation === "renameFolder" && <div className="manage-actions"><Button type="button" variant="outline" onClick={() => setTask({ ...task, operation: "moveFolder", title: `Move ${task.name}` })}>Move</Button><Button type="button" variant="danger" onClick={() => setTask({ ...task, operation: "deleteFolder", title: `Delete ${task.name}?`, danger: true })}>Delete</Button></div>}
      {task?.operation === "renameBook" && <div className="manage-actions"><Button type="button" variant="outline" onClick={() => setTask({ ...task, operation: "moveBook", title: `Move ${task.name}` })}>Move</Button><Button type="button" variant="danger" onClick={() => setTask({ ...task, operation: "deleteBook", title: `Delete ${task.name}?`, danger: true })}>Delete</Button></div>}
      {task?.operation === "moveFolder" && <label className="field-label">Parent folder<select className="input" name="parentId" defaultValue={task.parentId || ""}><option value="">Root</option>{library.folders.filter((f) => f.id !== task.folderId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {task?.operation === "moveBook" && <label className="field-label">Folder<select className="input" name="folderId" defaultValue={task.folderId || ""}><option value="">Root</option>{library.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {task?.danger && <p className="muted">{task.operation === "deleteFolder" ? "This also deletes nested folders and tunebooks. Saved tunes stay in Tunes." : "This removes the tunebook. Saved tunes stay in Tunes."}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><Dialog.Close asChild><Button type="button" variant="outline">Cancel</Button></Dialog.Close><Button disabled={busy} variant={task?.danger ? "danger" : "default"}>{busy ? "Saving…" : task?.danger ? "Delete" : "Save"}</Button></div>
    </form></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
