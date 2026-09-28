"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Folder, Layers, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookIcon } from "@/components/book-icon";
import { folderDescendants, folderPath as getFolderPath } from "@/lib/folder-tree";
import type { getLibrary } from "@/lib/library";

type Library = Awaited<ReturnType<typeof getLibrary>>;
type Operation = "createBook" | "createFolder" | "renameBook" | "renameFolder" | "moveBook" | "moveFolder" | "deleteBook" | "deleteFolder";
export type LibraryTask = { operation: Operation; title: string; name?: string; folderId?: string | null; bookId?: string; parentId?: string | null };

export function LibraryDialog({ task, library, onClose, onReturnFocus, onMove }: {
  task: LibraryTask; library: Library; onClose: () => void; onReturnFocus: () => void; onMove: (folderId: string | null) => void;
}) {
  const router = useRouter(), path = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(task.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const isBook = task.operation.endsWith("Book");
  const isCreate = task.operation.startsWith("create");
  const isRename = task.operation.startsWith("rename");
  const isMove = task.operation.startsWith("move");
  const isDelete = task.operation.startsWith("delete");
  const noun = isBook ? "tunebook" : "folder";
  const currentFolderId = (isBook ? task.folderId : task.parentId) ?? null;
  const [destination, setDestination] = useState<string | null>(currentFolderId);
  const nameRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const excluded = folderDescendants(library.folders, !isBook ? task.folderId : null);
  const folderPath = (folderId: string | null) => getFolderPath(library.folders, folderId);
  const destinations = [{ id: null as string | null, label: "Top level" }, ...library.folders
    .filter((folder) => !excluded.has(folder.id))
    .map((folder) => ({ id: folder.id, label: folderPath(folder.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))]
    .filter((folder) => folder.label.toLowerCase().includes(query.trim().toLowerCase()));
  const unchanged = isRename ? name.trim() === task.name : isMove ? destination === currentFolderId : false;
  const action = isCreate ? `Create ${noun}` : isRename ? "Rename" : isMove ? "Move here" : `Delete ${noun}`;
  const description = isCreate ? (isBook ? "Collect tunes into a set you can make your own." : "Group your tunebooks in one place.")
    : isRename ? `Give “${task.name}” a new name.`
    : isMove ? `Choose where “${task.name}” belongs.`
    : isBook ? `“${task.name}” will be deleted. Your saved tunes will stay in Tunes.`
    : `“${task.name}” and its nested folders and tunebooks will be deleted. Your saved tunes will stay in Tunes.`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || unchanged || ((isCreate || isRename) && !name.trim())) return;
    setBusy(true); setError("");
    try {
      const body = { operation: task.operation, bookId: task.bookId, folderId: isMove && isBook ? destination : task.folderId,
        parentId: isMove && !isBook ? destination : task.parentId,
        ...((isCreate || isRename) ? { name: name.trim() } : {}), ...(task.operation === "createBook" ? { emoji } : {}) };
      const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save changes");
      if (isMove) onMove(destination);
      const deletedCurrentBook = task.operation === "deleteBook" && path === `/books/${task.bookId}`;
      const deletedCurrentFolder = task.operation === "deleteFolder" && library.books.some((book) => book.folderId && excluded.has(book.folderId) && path === `/books/${book.id}`);
      onClose();
      if (deletedCurrentBook || deletedCurrentFolder) router.push("/");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save changes"); setBusy(false); }
  }

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="dialog-content library-dialog" role={isDelete ? "alertdialog" : "dialog"}
      onOpenAutoFocus={(event) => { event.preventDefault(); if (isDelete) cancelRef.current?.focus(); else if (isMove) searchRef.current?.focus(); else { nameRef.current?.focus(); nameRef.current?.select(); } }}
      onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }}
      onPointerDownOutside={(event) => { if (busy || isDelete) event.preventDefault(); }}
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <form onSubmit={submit}>
        <header className="library-dialog-head"><div><Dialog.Title className="dialog-title">{isCreate ? task.title : `${isRename ? "Rename" : isMove ? "Move" : "Delete"} ${noun}${isDelete ? "?" : ""}`}</Dialog.Title><Dialog.Description className="library-dialog-description">{description}</Dialog.Description></div><Dialog.Close asChild><button type="button" className="icon-button" disabled={busy} aria-label="Close dialog"><X size={18} /></button></Dialog.Close></header>
        <div className="library-dialog-body">
          {(isCreate || isRename) && <label className="field-label">{isBook ? "Tunebook name" : "Folder name"}<Input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={busy} /></label>}
          {task.operation === "createBook" && <div className="library-create-icon" inert={busy || undefined}><BookIcon size="draft" emoji={emoji} label="Change tunebook icon" onChange={setEmoji} /><span>Choose an icon</span></div>}
          {isMove && <>
            <p className="move-current">Currently in <strong>{folderPath(currentFolderId)}</strong></p>
            <div className="folder-search"><Search size={16} /><Input ref={searchRef} aria-label="Find a folder" placeholder="Find a folder…" value={query} onChange={(event) => setQuery(event.target.value)} disabled={busy} /></div>
            <fieldset className="folder-destinations" disabled={busy}><legend className="sr-only">Destination folder</legend>{destinations.map((folder) => <label key={folder.id ?? "root"} className={`folder-destination ${destination === folder.id ? "selected" : ""}`}><input type="radio" name="destination" value={folder.id ?? ""} checked={destination === folder.id} onChange={() => setDestination(folder.id)} />{folder.id ? <Folder size={16} /> : <Layers size={16} />}<span>{folder.label}</span>{folder.id === currentFolderId && <small>Current</small>}</label>)}{!destinations.length && <p className="muted">No folders match your search.</p>}</fieldset>
          </>}
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
        <footer className="library-dialog-footer"><Dialog.Close asChild><Button ref={cancelRef} type="button" variant="outline" disabled={busy}>Cancel</Button></Dialog.Close><Button disabled={busy || unchanged || ((isCreate || isRename) && !name.trim())} variant={isDelete ? "danger" : "default"}>{busy ? (isDelete ? "Deleting…" : isMove ? "Moving…" : "Saving…") : action}</Button></footer>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
