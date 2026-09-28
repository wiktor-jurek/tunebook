"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Folder, ListMusic, Music2, LogOut, Plus, MoreHorizontal, Pencil, FolderInput, Trash2, X } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ProfilePreferences } from "@/components/profile-preferences";
import { BookIcon } from "@/components/book-icon";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LibraryDialog, type LibraryTask as Task } from "@/components/library-dialog";
import type { getLibrary } from "@/lib/library";

type Library = Awaited<ReturnType<typeof getLibrary>>;
type FolderRow = Library["folders"][number];
type BookRow = Library["books"][number];
export function Sidebar({ library, userName, defaultSound }: { library: Library; userName?: string; defaultSound: number }) {
  const path = usePathname(), router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const newButton = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const guest = userName === undefined;
  const signIn = `/sign-in?next=${encodeURIComponent(path)}`;
  const foldersByParent = (parent: string | null) => library.folders.filter((f) => f.parentId === parent);
  const booksByFolder = (folder: string | null) => library.books.filter((b) => b.folderId === folder);
  const launch = (next: Task) => setTask(next);
  const closeMobile = () => setMobileOpen(false);
  const managementMenu = (name: string, target: { bookId: string; folderId: string | null } | { folderId: string; parentId: string | null }) => {
    const kind = "bookId" in target ? "Book" : "Folder";
    return <DropdownMenu><DropdownMenuTrigger asChild><button className="icon-button subtle" aria-label={`Actions for ${name}`} title={`Actions for ${name}`} onPointerDown={(event) => { returnFocus.current = event.currentTarget; }} onFocus={(event) => { returnFocus.current = event.currentTarget; }}><MoreHorizontal size={16} /></button></DropdownMenuTrigger><DropdownMenuContent className="nav-action-menu" align="end" onCloseAutoFocus={(event) => { if (task) event.preventDefault(); }}><DropdownMenuLabel>{name}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => launch({ ...target, operation: `rename${kind}`, title: "Rename", name })}><Pencil size={15} /><span>Rename</span></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => launch({ ...target, operation: `move${kind}`, title: "Move", name })}><FolderInput size={16} /><span>Move to…</span></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="dropdown-danger" onSelect={() => launch({ ...target, operation: `delete${kind}`, title: "Delete", name })}><Trash2 size={15} /><span>Delete</span></DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>;
  };
  function revealDestination(folderId: string | null) {
    const parents: string[] = [];
    let cursor = folderId;
    while (cursor && !parents.includes(cursor)) {
      parents.push(cursor); cursor = library.folders.find((folder) => folder.id === cursor)?.parentId ?? null;
    }
    setOpen((current) => ({ ...current, ...Object.fromEntries(parents.map((id) => [id, true])) }));
  }
  const bookLink = (book: BookRow) => <div key={book.id} className={`nav-row nav-book-row ${path === `/books/${book.id}` ? "active" : ""}`}><BookIcon bookId={book.id} emoji={book.emoji} label={`Change icon for ${book.name}`} /><Link onClick={closeMobile} className="nav-link nav-book" aria-current={path === `/books/${book.id}` ? "page" : undefined} href={`/books/${book.id}`}><span>{book.name}</span></Link>{managementMenu(book.name, { bookId: book.id, folderId: book.folderId })}</div>;
  const createInside = (next: Task, folder?: FolderRow) => {
    if (folder) setOpen((current) => ({ ...current, [folder.id]: true }));
    launch(next);
  };
  const creationMenu = (folder?: FolderRow) => <DropdownMenu><DropdownMenuTrigger asChild><button ref={folder ? undefined : newButton} onPointerDown={(event) => { returnFocus.current = event.currentTarget; }} onFocus={(event) => { returnFocus.current = event.currentTarget; }} className={folder ? "icon-button subtle" : "nav-new-button"} aria-label={folder ? `Add inside ${folder.name}` : "Create a tunebook or folder"} title={folder ? `Add inside ${folder.name}` : "Create a tunebook or folder"}><Plus size={14} />{!folder && <span>New</span>}</button></DropdownMenuTrigger><DropdownMenuContent className="nav-create-menu" align="end" onCloseAutoFocus={(event) => { if (task) event.preventDefault(); }}><DropdownMenuLabel>{folder ? `Inside ${folder.name}` : "Create"}</DropdownMenuLabel><DropdownMenuItem onSelect={() => createInside({ operation: "createBook", title: "New tunebook", folderId: folder?.id ?? null }, folder)}><BookOpen size={16} /><span>New tunebook</span></DropdownMenuItem><DropdownMenuItem onSelect={() => createInside({ operation: "createFolder", title: "New folder", parentId: folder?.id ?? null }, folder)}><Folder size={16} /><span>{folder ? "New subfolder" : "New folder"}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  const renderFolder = (folder: FolderRow): React.ReactNode => <div key={folder.id}>
    <div className="nav-row"><button className="nav-link nav-folder" aria-expanded={open[folder.id] ?? true} onClick={() => setOpen({ ...open, [folder.id]: !(open[folder.id] ?? true) })}>{open[folder.id] ?? true ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Folder size={15} /><span>{folder.name}</span></button>{creationMenu(folder)}{managementMenu(folder.name, { folderId: folder.id, parentId: folder.parentId })}</div>
    {(open[folder.id] ?? true) && <div className="nav-children">{foldersByParent(folder.id).map(renderFolder)}{booksByFolder(folder.id).map(bookLink)}</div>}
  </div>;
  return <>
    <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><BookOpen size={18} /> Tunebook</button>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={closeMobile} />}
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-head"><Link href="/" className="brand" onClick={closeMobile}><span className="brand-mark">𝄞</span><span>Tunebook</span></Link><button className="icon-button mobile-close" onClick={closeMobile} aria-label="Close navigation"><X size={18} /></button></div>
      <nav aria-label="Main navigation">
        <div className="nav-section">{guest ? <><div className="nav-link"><Music2 size={16} /> Tunes</div><Link onClick={closeMobile} href={signIn} className="nav-login">Log in to save tunes</Link></> : <Link onClick={closeMobile} href="/" className={`nav-link ${path === "/" ? "active" : ""}`}><Music2 size={16} /> Tunes <span className="nav-count">{library.tunes.length}</span></Link>}</div>
        {!guest && <Link onClick={closeMobile} href="/sets" className={`nav-link nav-my-sets ${path === "/sets" ? "active" : ""}`} aria-current={path === "/sets" ? "page" : undefined}><ListMusic size={16} /> My sets <span className="nav-count">{library.sets.length}</span></Link>}
        <div className="nav-label-row"><span>TUNEBOOKS</span>{!guest && creationMenu()}</div>
        {guest ? <Link onClick={closeMobile} href={signIn} className="nav-login">Log in to save tunebooks</Link> : <div>{booksByFolder(null).map(bookLink)}{foldersByParent(null).map(renderFolder)}</div>}
        <div className="nav-label-row nav-shared-label"><span>SHARED WITH ME</span></div>
        <div>{library.sharedBooks.map((book) => <Link key={book.id} onClick={closeMobile} href={`/books/${book.id}`} className={`nav-link nav-shared-book ${path === `/books/${book.id}` ? "active" : ""}`} aria-current={path === `/books/${book.id}` ? "page" : undefined}><BookIcon bookId={book.id} emoji={book.emoji} label="Tunebook icon" readOnly /><span>{book.name}</span></Link>)}{!library.sharedBooks.length && <p className="nav-empty">Tunebooks shared with you appear here.</p>}</div>
      </nav>
      <div className="sidebar-bottom">{guest ? <Link onClick={closeMobile} href={signIn} className="nav-link">Log in to Tunebook</Link> : <><ProfilePreferences userName={userName} defaultSound={defaultSound} /><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={async () => { await authClient.signOut(); router.push("/sign-in"); router.refresh(); }}><LogOut size={16} /></button></>}</div>
    </aside>
    {task && <LibraryDialog key={`${task.operation}-${task.bookId ?? task.folderId ?? "root"}`} task={task} library={library} onClose={() => setTask(null)} onMove={revealDestination} onReturnFocus={() => { requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus(); else newButton.current?.focus(); }); }} />}
  </>;
}
