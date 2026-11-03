type Folder = { id: string; name: string; parentId: string | null };

export function folderDescendants(folders: Folder[], folderId?: string | null) {
  const blocked = new Set<string>(folderId ? [folderId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && blocked.has(folder.parentId) && !blocked.has(folder.id)) {
        blocked.add(folder.id); changed = true;
      }
    }
  }
  return blocked;
}

export function folderPath(folders: Folder[], folderId: string | null): string {
  if (!folderId) return "Top level";
  const names: string[] = [], seen = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = folders.find((row) => row.id === cursor);
    if (!folder) break;
    names.unshift(folder.name); cursor = folder.parentId;
  }
  return names.join(" / ");
}
